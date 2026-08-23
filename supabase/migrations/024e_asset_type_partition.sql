-- ============================================================================
-- 024e_asset_type_partition.sql
--
-- Replaces ledger_credit_closed_loop with a full three-way partition, and
-- fixes the two functions that were writing types the old rule rejected.
--
-- THE OLD RULE
--   (asset = 'credit') = (entry_type in (credit_purchase, credit_sale_gross,
--                                        credit_sale_net, credit_sale_fee))
-- Correct and airtight, but it only constrained the credit side. Nothing
-- stopped a card type appearing on currency, and it had no room for the
-- reversal and trade types added since.
--
-- THE NEW RULE
-- Every entry type belongs to exactly one asset class, enumerated. Same
-- guarantee, extended to all three classes, and it fails loudly the next time
-- a migration adds a type without deciding what it is - which is precisely how
-- this bug was found.
--
-- ALSO FIXED HERE
--   fn_confirm_sale_cancellation  mapped BOTH sale_gross and credit_sale_gross
--                                 onto sale_reversal_gross, so cancelling an
--                                 FSC-paid sale hit the constraint. Now each
--                                 maps to its own asset's reversal type.
--   fn_accept_trade_offer         booked the flat fee as `trade_fee` on
--                                 credit. Now trade_credit_fee.
--
-- DEPENDS ON: 023b, 024a, 024d.
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The partition
-- ---------------------------------------------------------------------------
alter table ledger_entries drop constraint if exists ledger_credit_closed_loop;
alter table ledger_entries drop constraint if exists ledger_asset_type_partition;

alter table ledger_entries add constraint ledger_asset_type_partition check (
  (asset = 'credit' and entry_type = any (array[
      'credit_purchase',              -- dead: the top-up era, kept for history
      'credit_sale_gross',
      'credit_sale_net',
      'credit_sale_fee',
      'credit_sale_reversal_gross',
      'credit_sale_reversal_net',
      'credit_sale_reversal_fee',
      'trade_credit_gross',
      'trade_credit_net',
      'trade_credit_fee',
      'platform_credit_settle'
    ]::ledger_entry_type[]))
  or
  (asset = 'card' and entry_type = any (array[
      'mint',
      'card_transfer',
      'redemption_burn',
      'vault_default_burn',
      'trade_up_burn',                -- dead: no RNG mechanics, CGHA 1953
      'trade_up_mint'                 -- dead: same
    ]::ledger_entry_type[]))
  or
  (asset = 'currency' and entry_type = any (array[
      'sale_gross',
      'sale_net',
      'sale_fee',
      'sale_reversal_gross',
      'sale_reversal_net',
      'sale_reversal_fee',
      'handling_fee',
      'consignment_fee',
      'subscription_fee',
      'trade_fee',                    -- reserved for a future cash boot
      'payout_hold',
      'payout_release'
    ]::ledger_entry_type[]))
);

comment on constraint ledger_asset_type_partition on ledger_entries is
  'Every entry type belongs to exactly one asset class. Adding a type without '
  'adding it here makes every insert of that type fail - deliberately, so the '
  'decision cannot be skipped.';

-- ---------------------------------------------------------------------------
-- 2. fn_confirm_sale_cancellation - map each asset to its own reversal type
-- ---------------------------------------------------------------------------
create or replace function fn_confirm_sale_cancellation(
  p_order_id uuid, p_refund_ref text, p_ban_consignor boolean default true
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_o         orders%rowtype;
  v_i         vault_intakes%rowtype;
  v_txn       uuid := gen_random_uuid();
  v_e         record;
  v_type      ledger_entry_type;
  v_consignor uuid;
  v_pulled    int := 0;
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

  for v_e in
    select * from ledger_entries
     where txn_id = v_o.txn_id and asset <> 'card'
  loop
    -- Each asset gets its own reversal type. The old version collapsed both
    -- onto the currency types, which the asset partition rejects - so
    -- cancelling an FSC-paid sale failed outright.
    v_type := case v_e.entry_type
      when 'sale_gross'        then 'sale_reversal_gross'
      when 'sale_net'          then 'sale_reversal_net'
      when 'sale_fee'          then 'sale_reversal_fee'
      when 'credit_sale_gross' then 'credit_sale_reversal_gross'
      when 'credit_sale_net'   then 'credit_sale_reversal_net'
      when 'credit_sale_fee'   then 'credit_sale_reversal_fee'
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

  insert into ledger_entries (txn_id, entry_type, asset, account_id,
                              card_id, direction)
  values (v_txn, 'vault_default_burn', 'card', v_o.buyer_id, v_o.card_id, -1);

  update cards set status = 'burned' where id = v_o.card_id;
  update items set status = 'returned_to_consignor' where id = (
    select item_id from cards where id = v_o.card_id
  );

  update orders set status = 'cancelled', payout_release_at = null
   where id = p_order_id;

  if v_i.id is not null then
    update vault_intakes set status = 'cancelled' where id = v_i.id;
  end if;

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

  -- Open trade offers involving a burned card can never settle.
  update trade_offers set status = 'cancelled', resolved_at = now()
   where status = 'open'
     and (offered_card_id = v_o.card_id or requested_card_id = v_o.card_id);

  raise notice 'order % cancelled, % listing(s) pulled', p_order_id, v_pulled;
  return v_txn;
end $$;

-- ---------------------------------------------------------------------------
-- 3. fn_accept_trade_offer - the fee is credit, so it books trade_credit_fee
-- ---------------------------------------------------------------------------
create or replace function fn_accept_trade_offer(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user   uuid;
  v_o      trade_offers%rowtype;
  v_off    cards%rowtype;
  v_req    cards%rowtype;
  v_payee  uuid;
  v_avail  bigint;
  v_owed   bigint;
  v_txn    uuid := gen_random_uuid();
  v_lvl_i  smallint;
  v_lvl_r  smallint;
begin
  v_user := fn_current_user_id();
  if v_user is null then raise exception 'sign in to accept a trade'; end if;

  select * into v_o from trade_offers where id = p_offer_id for update;
  if not found then raise exception 'offer % not found', p_offer_id; end if;
  if v_o.recipient_id <> v_user then
    raise exception 'offer % was not made to you', p_offer_id;
  end if;
  if v_o.status <> 'open' then
    raise exception 'offer % is %', p_offer_id, v_o.status;
  end if;
  if v_o.expires_at <= now() then
    update trade_offers set status = 'expired', resolved_at = now()
     where id = p_offer_id;
    raise exception 'offer % expired at %', p_offer_id, v_o.expires_at;
  end if;

  select * into v_off from cards where id = v_o.offered_card_id for update;
  select * into v_req from cards where id = v_o.requested_card_id for update;

  if v_off.owner_id <> v_o.initiator_id then
    raise exception 'the offered card no longer belongs to the initiator';
  end if;
  if v_req.owner_id <> v_o.recipient_id then
    raise exception 'you no longer own the requested card';
  end if;
  if v_off.status <> 'active' then
    raise exception 'the offered card is %, expected active', v_off.status;
  end if;
  if v_req.status <> 'active' then
    raise exception 'your card is %, expected active', v_req.status;
  end if;

  v_owed  := v_o.imbalance_cents + v_o.fee_cents;
  v_payee := case when v_o.payer_id = v_o.initiator_id
                  then v_o.recipient_id else v_o.initiator_id end;

  perform 1 from users where id = v_o.payer_id for update;
  if v_owed > 0 then
    v_avail := fn_credit_available_unchecked(v_o.payer_id);
    if v_o.hold_id is not null then
      v_avail := v_avail + coalesce(
        (select amount_cents from credit_holds
          where id = v_o.hold_id and status = 'active'), 0);
    end if;
    if v_avail < v_owed then
      raise exception 'the paying side no longer has % FSC available', v_owed;
    end if;
  end if;

  if v_o.imbalance_cents > 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn,'trade_credit_gross','credit', v_o.payer_id, false,
            v_o.imbalance_cents, -1),
           (v_txn,'trade_credit_net','credit', v_payee, false,
            v_o.imbalance_cents, 1);
  end if;

  -- CHANGED (024e): trade_credit_fee, not trade_fee. Both legs carry the same
  -- type, so the type nets to zero and trade revenue is the is_platform side.
  if v_o.fee_cents > 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn,'trade_credit_fee','credit', v_o.payer_id, false,
            v_o.fee_cents, -1),
           (v_txn,'trade_credit_fee','credit', null, true,
            v_o.fee_cents, 1);
  end if;

  insert into ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction)
  values (v_txn,'card_transfer','card', v_o.initiator_id, v_o.offered_card_id,   -1),
         (v_txn,'card_transfer','card', v_o.recipient_id, v_o.offered_card_id,    1),
         (v_txn,'card_transfer','card', v_o.recipient_id, v_o.requested_card_id, -1),
         (v_txn,'card_transfer','card', v_o.initiator_id, v_o.requested_card_id,  1);

  update cards set owner_id = v_o.recipient_id where id = v_o.offered_card_id;
  update cards set owner_id = v_o.initiator_id where id = v_o.requested_card_id;

  select level into v_lvl_i from users where id = v_o.initiator_id;
  select level into v_lvl_r from users where id = v_o.recipient_id;

  update card_provenance set released_at = now()
   where card_id = v_o.offered_card_id and owner_id = v_o.initiator_id
     and released_at is null;
  update card_provenance set released_at = now()
   where card_id = v_o.requested_card_id and owner_id = v_o.recipient_id
     and released_at is null;

  insert into card_provenance (card_id, owner_id, owner_level, acquired_at)
  values (v_o.offered_card_id,   v_o.recipient_id, coalesce(v_lvl_r,1), now()),
         (v_o.requested_card_id, v_o.initiator_id, coalesce(v_lvl_i,1), now());

  if v_o.hold_id is not null then
    update credit_holds set status = 'consumed', consumed_at = now()
     where id = v_o.hold_id and status = 'active';
  end if;

  update trade_offers
     set status = 'accepted', resolved_at = now(), txn_id = v_txn
   where id = p_offer_id;

  update trade_offers
     set status = 'cancelled', resolved_at = now()
   where status = 'open'
     and id <> p_offer_id
     and (offered_card_id   in (v_o.offered_card_id, v_o.requested_card_id)
       or requested_card_id in (v_o.offered_card_id, v_o.requested_card_id));

  perform fn_award_xp(v_o.initiator_id, 'trade', 15, p_offer_id);
  perform fn_award_xp(v_o.recipient_id, 'trade', 15, p_offer_id);

  return v_txn;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes int;
  v_missing text;
begin
  select count(*) into v_dupes from (
    select proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
    group by proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '024e: % function(s) now have multiple arities', v_dupes;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ledger_asset_type_partition'
      and conrelid = 'public.ledger_entries'::regclass
  ) then
    raise exception '024e: the asset partition constraint is missing';
  end if;

  -- Every enum value must be classified. An unclassified type would fail on
  -- first insert, which is a bad place to learn about it.
  select string_agg(e.enumlabel, ', ') into v_missing
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'ledger_entry_type'
    and e.enumlabel not in (
      'credit_purchase','credit_sale_gross','credit_sale_net','credit_sale_fee',
      'credit_sale_reversal_gross','credit_sale_reversal_net',
      'credit_sale_reversal_fee','trade_credit_gross','trade_credit_net',
      'trade_credit_fee','platform_credit_settle',
      'mint','card_transfer','redemption_burn','vault_default_burn',
      'trade_up_burn','trade_up_mint',
      'sale_gross','sale_net','sale_fee','sale_reversal_gross',
      'sale_reversal_net','sale_reversal_fee','handling_fee','consignment_fee',
      'subscription_fee','trade_fee','payout_hold','payout_release'
    );
  if v_missing is not null then
    raise exception
      '024e: ledger_entry_type value(s) not classified by the partition: %',
      v_missing;
  end if;

  raise notice '024e ok: asset partition in place, reversal and trade fee types pinned';
end $$;

commit;
