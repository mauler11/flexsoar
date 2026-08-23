-- ============================================================================
-- 023c_vault_custody.sql
--
-- The custody model decided 2026-08-22. Physical possession moves to FlexSoar
-- on FIRST SALE, and the card is frozen until the shoe actually arrives.
--
--   1. Consignor lists a shoe held at their own house.
--   2. Buyer A buys it. Ownership transfers, but the card goes PENDING_VAULT.
--   3. Consignor must ship to FlexSoar within 48h (vault_intakes.due_by).
--   4. On receipt: item goes to warehouse custody, card goes ACTIVE, and it
--      is freely tradeable from then on.
--   5. If the consignor does not ship: cancel, refund Buyer A in full and in
--      kind, burn the card, ban the consignor, pull their other listings.
--
-- WHY: without the freeze, a card can change hands a hundred times while the
-- shoe sits in the original consignor's house, so every holder after the first
-- is trusting a stranger indefinitely. Freezing until vault-in bounds that
-- trust to one 48-hour window with one KYC'd person.
--
-- WHAT THIS FILE DOES NOT NEED TO DO, because the existing functions already
-- enforce it:
--   fn_list_card   requires cards.status = 'active'  -> cannot list
--   fn_redeem_card requires cards.status = 'active'  -> cannot redeem
--   a card can only be sold via a listing            -> cannot resell
-- A pending_vault card is therefore inert without a single new guard. The only
-- behaviour this file adds is landing it in pending_vault in the first place.
--
-- DEPENDS ON: 023a (card_status.pending_vault), 023b (reversal entry types).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The 48-hour clock
--
-- A separate table rather than a new item_status, because item_status already
-- uses `awaiting_seller_shipment` for a DIFFERENT journey - a consignor
-- shipping to a redeeming holder, on the 7-day seller_shipment_days SLA.
-- Overloading it would make "shipping to a customer" and "shipping to the
-- vault" indistinguishable, and they have different deadlines, different
-- recipients and different failure consequences.
--
-- It also gives you a default rate you can measure. That number decides
-- whether this model works.
-- ---------------------------------------------------------------------------
create table if not exists vault_intakes (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id),
  item_id         uuid not null references items(id),
  card_id         uuid not null references cards(id),
  consignor_id    uuid not null references users(id),
  buyer_id        uuid not null references users(id),
  status          text not null default 'awaiting_shipment',
  due_by          timestamptz not null,
  carrier         text,
  tracking_number text,
  shipped_at      timestamptz,
  received_at     timestamptz,
  defaulted_at    timestamptz,
  note            text,
  created_at      timestamptz not null default now(),
  constraint vault_intakes_status_check check (
    status in ('awaiting_shipment','in_transit','received','defaulted','cancelled')
  )
);

-- One open intake per item. A second first-sale is a contradiction.
create unique index if not exists vault_intakes_one_open_per_item
  on vault_intakes (item_id)
  where status in ('awaiting_shipment','in_transit');

create index if not exists vault_intakes_due_by_idx
  on vault_intakes (due_by) where status in ('awaiting_shipment','in_transit');

alter table vault_intakes enable row level security;

-- Consignor sees their own obligations; buyer sees where their shoe is.
drop policy if exists vault_intakes_read_own on vault_intakes;
create policy vault_intakes_read_own on vault_intakes
  for select to authenticated
  using (
    consignor_id = fn_current_user_id()
    or buyer_id  = fn_current_user_id()
    or fn_is_admin()
  );

-- No INSERT/UPDATE/DELETE policy: writes go through the functions below,
-- consistent with every other table.

comment on table vault_intakes is
  'The 48-hour window between a first sale and the physical shoe reaching '
  'FlexSoar. The card stays pending_vault for the duration.';

-- ---------------------------------------------------------------------------
-- 2. Config
-- ---------------------------------------------------------------------------
insert into platform_config (key, num_value, note)
values (
  'vault_intake_hours', 48,
  'Hours a consignor has to ship the physical shoe to FlexSoar after its card '
  'first sells. Must stay WELL BELOW payout_hold_days (7 days) - a default is '
  'unwound by reversing the sale, and that only works while the consignor''s '
  'payout is still held. Raising this above the payout hold breaks the unwind '
  'silently.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Open an intake on first sale
--
-- AFTER INSERT on orders, which in fn_purchase_card_core runs BEFORE the
-- `update cards set status = 'active'` at the end of that function. That
-- ordering is what lets the BEFORE UPDATE trigger in step 4 see an open intake
-- and force pending_vault.
--
-- FIRST SALE means: the item is still in the consignor's custody and no intake
-- has ever been opened for it. A resale of a vaulted card matches neither.
-- ---------------------------------------------------------------------------
create or replace function trg_open_vault_intake()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item  items%rowtype;
  v_hours bigint;
begin
  select * into v_item from items where id = (
    select item_id from cards where id = new.card_id
  );

  if not found then
    return new;
  end if;

  -- Already vaulted, or an intake already exists: this is a resale.
  if v_item.custody <> 'seller' then
    return new;
  end if;
  if exists (select 1 from vault_intakes where item_id = v_item.id) then
    return new;
  end if;

  v_hours := coalesce(fn_config_num('vault_intake_hours'), 48);

  insert into vault_intakes (order_id, item_id, card_id, consignor_id,
                             buyer_id, due_by)
  values (new.id, v_item.id, new.card_id,
          coalesce(v_item.consignor_id, new.seller_id),
          new.buyer_id,
          now() + make_interval(hours => v_hours::int));

  return new;
end $$;

drop trigger if exists open_vault_intake on orders;
create trigger open_vault_intake
  after insert on orders
  for each row execute function trg_open_vault_intake();

-- ---------------------------------------------------------------------------
-- 4. Force pending_vault while an intake is open
--
-- fn_purchase_card_core ends with `update cards set owner_id = ...,
-- status = 'active'`. Rather than reissue that function - 200 lines, verified
-- working against live SQL on 2026-08-22, and the riskiest thing in the
-- schema to touch - this intercepts the status it writes.
--
-- Deliberately narrow: it only ever downgrades 'active' to 'pending_vault',
-- and only while an intake is open. It cannot promote anything.
-- ---------------------------------------------------------------------------
create or replace function trg_hold_card_pending_vault()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  if exists (
    select 1 from vault_intakes
    where card_id = new.id
      and status in ('awaiting_shipment','in_transit')
  ) then
    new.status := 'pending_vault';
  end if;

  return new;
end $$;

drop trigger if exists hold_card_pending_vault on cards;
create trigger hold_card_pending_vault
  before update on cards
  for each row execute function trg_hold_card_pending_vault();

-- ---------------------------------------------------------------------------
-- 5. Consignor marks it shipped
-- ---------------------------------------------------------------------------
create or replace function fn_vault_mark_shipped(
  p_intake_id uuid, p_carrier text, p_tracking text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_i vault_intakes%rowtype;
begin
  select * into v_i from vault_intakes where id = p_intake_id for update;
  if not found then raise exception 'vault intake % not found', p_intake_id; end if;

  if v_i.consignor_id is distinct from fn_current_user_id() and not fn_is_admin() then
    raise exception 'not your consignment';
  end if;
  if v_i.status <> 'awaiting_shipment' then
    raise exception 'vault intake % is %', p_intake_id, v_i.status;
  end if;
  if coalesce(btrim(p_tracking), '') = '' then
    raise exception 'a tracking number is required';
  end if;

  update vault_intakes
     set status = 'in_transit', carrier = p_carrier,
         tracking_number = p_tracking, shipped_at = now()
   where id = p_intake_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Vault it in - the card comes alive
--
-- This is also the moment grade_source can honestly become 'flexsoar': it is
-- the first time anyone at FlexSoar has physically held the shoe. Left to the
-- caller rather than forced here, because regrading is a separate decision.
-- ---------------------------------------------------------------------------
create or replace function fn_vault_receive(
  p_intake_id uuid, p_location text, p_note text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_i vault_intakes%rowtype;
begin
  perform fn_require_admin();

  select * into v_i from vault_intakes where id = p_intake_id for update;
  if not found then raise exception 'vault intake % not found', p_intake_id; end if;
  if v_i.status not in ('awaiting_shipment','in_transit') then
    raise exception 'vault intake % is %', p_intake_id, v_i.status;
  end if;

  update vault_intakes
     set status = 'received', received_at = now(),
         note = coalesce(p_note, note)
   where id = p_intake_id;

  update items
     set custody          = 'warehouse',
         custody_holder_id = null,
         custody_location = p_location,
         status           = 'in_custody',
         authenticated_at = coalesce(authenticated_at, now()),
         authenticated_by = coalesce(authenticated_by, fn_current_user_id())
   where id = v_i.item_id;

  -- The intake is closed, so the step-4 trigger no longer holds it down.
  update cards set status = 'active'
   where id = v_i.card_id and status = 'pending_vault';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Default: step one of two
--
-- Marks the order for cancellation. Writes NO reversal entries and moves no
-- money, because the Stripe refund has not happened yet and the database
-- cannot call Stripe.
--
-- Two steps rather than one, for the same reason FSC is reserved at checkout
-- rather than spent at settlement: the gap between an external system acting
-- and the ledger recording it is where money goes missing. A ledger that says
-- "refunded" when Stripe never refunded is worse than one that says "pending".
-- ---------------------------------------------------------------------------
create or replace function fn_vault_mark_defaulted(
  p_intake_id uuid, p_note text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_i vault_intakes%rowtype;
  v_o orders%rowtype;
begin
  perform fn_require_admin();

  select * into v_i from vault_intakes where id = p_intake_id for update;
  if not found then raise exception 'vault intake % not found', p_intake_id; end if;
  if v_i.status not in ('awaiting_shipment','in_transit') then
    raise exception 'vault intake % is %', p_intake_id, v_i.status;
  end if;
  if now() < v_i.due_by then
    raise exception 'vault intake % is not due until %', p_intake_id, v_i.due_by;
  end if;

  select * into v_o from orders where id = v_i.order_id for update;
  if v_o.status <> 'settled' then
    raise exception 'order % is %, expected settled', v_o.id, v_o.status;
  end if;

  update vault_intakes
     set status = 'defaulted', defaulted_at = now(), note = coalesce(p_note, note)
   where id = p_intake_id;

  update orders set status = 'cancellation_pending' where id = v_o.id;

  return v_o.id;
end $$;

comment on function fn_vault_mark_defaulted(uuid, text) is
  'Step 1 of 2. Marks the order cancellation_pending. Issue the Stripe refund '
  'for orders.cash_cents, then call fn_confirm_sale_cancellation with the '
  'refund reference. No money moves in the ledger until that second call.';

-- ---------------------------------------------------------------------------
-- 8. Default: step two of two, after Stripe has actually refunded
--
-- Reverses the sale by mirroring every original non-card leg with its
-- reversal type and the opposite direction. Mirroring rather than
-- recalculating guarantees each asset class nets to zero without restating
-- the fee arithmetic - if the original was balanced, the reversal is too.
--
-- The buyer is made whole in kind: cash back as cash, FSC back as FSC, and a
-- split refunds proportionally, because the mirror carries whatever the
-- original legs were. The platform eats the Stripe processing fee; the buyer
-- did nothing wrong, and a disputed refund costs far more than the fee.
-- ---------------------------------------------------------------------------
create or replace function fn_confirm_sale_cancellation(
  p_order_id uuid, p_refund_ref text, p_ban_consignor boolean default true
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_o        orders%rowtype;
  v_i        vault_intakes%rowtype;
  v_txn      uuid := gen_random_uuid();
  v_e        record;
  v_type     ledger_entry_type;
  v_consignor uuid;
  v_pulled   int := 0;
begin
  perform fn_require_admin();

  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if v_o.status <> 'cancellation_pending' then
    raise exception 'order % is %, expected cancellation_pending',
      p_order_id, v_o.status;
  end if;
  if v_o.cash_cents > 0 and coalesce(btrim(p_refund_ref), '') = '' then
    raise exception
      'order % refunded % cents of cash and needs the Stripe refund reference',
      p_order_id, v_o.cash_cents;
  end if;

  select * into v_i from vault_intakes where order_id = p_order_id for update;
  v_consignor := coalesce(v_i.consignor_id, v_o.seller_id);

  -- Mirror every valued leg of the original transaction.
  for v_e in
    select * from ledger_entries
     where txn_id = v_o.txn_id and asset <> 'card'
  loop
    v_type := case v_e.entry_type
      when 'sale_gross'        then 'sale_reversal_gross'
      when 'credit_sale_gross' then 'sale_reversal_gross'
      when 'sale_net'          then 'sale_reversal_net'
      when 'credit_sale_net'   then 'sale_reversal_net'
      when 'sale_fee'          then 'sale_reversal_fee'
      when 'credit_sale_fee'   then 'sale_reversal_fee'
      else null
    end;

    if v_type is null then
      raise exception
        'order % has an unexpected ledger entry type % - refusing to guess at '
        'its reversal', p_order_id, v_e.entry_type;
    end if;

    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction,
                                settlement_ref)
    values (v_txn, v_type, v_e.asset, v_e.account_id, v_e.is_platform,
            v_e.amount_cents, (-v_e.direction)::smallint,
            nullif(btrim(p_refund_ref), ''));
  end loop;

  -- Burn the card. Distinct from redemption_burn: nobody got a shoe.
  insert into ledger_entries (txn_id, entry_type, asset, account_id,
                              card_id, direction)
  values (v_txn, 'vault_default_burn', 'card', v_o.buyer_id, v_o.card_id, -1);

  update cards set status = 'burned' where id = v_o.card_id;
  update items set status = 'returned_to_consignor' where id = (
    select item_id from cards where id = v_o.card_id
  );

  update orders
     set status = 'cancelled', payout_release_at = null
   where id = p_order_id;

  if v_i.id is not null then
    update vault_intakes set status = 'cancelled' where id = v_i.id;
  end if;

  -- Ban the consignor and pull everything else they have live. A consignor
  -- who did not ship one shoe is not trusted to ship the others.
  if p_ban_consignor then
    update users set is_restricted = true where id = v_consignor;

    with pulled as (
      update listings set status = 'cancelled'
       where seller_id = v_consignor
         and status in ('early_access','public')
      returning card_id
    )
    update cards set status = 'active'
     where id in (select card_id from pulled)
       and status = 'locked';

    get diagnostics v_pulled = row_count;
  end if;

  raise notice 'order % cancelled, % listing(s) pulled', p_order_id, v_pulled;
  return v_txn;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Card-leg balance constraint
--
-- The ledger has had constraint triggers for currency and credit since the
-- start, but never for cards - nothing stopped a transfer inserting a +1
-- without its -1 (duplicating a card) or the reverse (destroying one).
-- Harmless so far because every card_transfer has been written by one
-- function. 024 trades writes FOUR card legs per transaction, which is the
-- most leg-droppable shape in the system, so this wants to exist first.
--
-- Mints and burns are deliberately exempt: cards are created and destroyed,
-- not conserved. Only transfers must pair.
-- ---------------------------------------------------------------------------
create or replace function trg_ledger_card_balanced()
returns trigger
language plpgsql
as $$
declare v_bad text;
begin
  select string_agg(card_id::text, ', ') into v_bad
  from (
    select card_id, sum(direction) as net
    from ledger_entries
    where txn_id = new.txn_id
      and asset = 'card'
      and entry_type in ('card_transfer','trade_fee')
    group by card_id
  ) x
  where net <> 0;

  if v_bad is not null then
    raise exception
      'card transfer legs do not pair in txn % for card(s) %', new.txn_id, v_bad;
  end if;

  return null;
end $$;

drop trigger if exists ledger_card_balanced on ledger_entries;
create constraint trigger ledger_card_balanced
  after insert on ledger_entries
  deferrable initially deferred
  for each row execute function trg_ledger_card_balanced();

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
revoke execute on function fn_vault_mark_shipped(uuid, text, text)          from public, anon;
revoke execute on function fn_vault_receive(uuid, text, text)               from public, anon;
revoke execute on function fn_vault_mark_defaulted(uuid, text)              from public, anon;
revoke execute on function fn_confirm_sale_cancellation(uuid, text, boolean) from public, anon;

grant execute on function fn_vault_mark_shipped(uuid, text, text)           to authenticated;
grant execute on function fn_vault_receive(uuid, text, text)                to authenticated;
grant execute on function fn_vault_mark_defaulted(uuid, text)               to authenticated;
grant execute on function fn_confirm_sale_cancellation(uuid, text, boolean)  to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
    group by proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '023c: % function(s) now have multiple arities', v_dupes;
  end if;

  if not exists (select 1 from pg_trigger
                 where tgname = 'hold_card_pending_vault' and not tgisinternal) then
    raise exception '023c: hold_card_pending_vault trigger missing';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'ledger_card_balanced' and not tgisinternal) then
    raise exception '023c: ledger_card_balanced trigger missing';
  end if;

  -- the new card constraint must not reject history
  if exists (
    select 1 from (
      select txn_id, card_id, sum(direction) as net
      from ledger_entries
      where asset = 'card' and entry_type in ('card_transfer','trade_fee')
      group by txn_id, card_id
    ) x where net <> 0
  ) then
    raise exception
      '023c: existing card_transfer history would violate the new constraint';
  end if;

  raise notice '023c ok: vault state machine, unwind, and card-leg constraint in place';
end $$;

commit;
