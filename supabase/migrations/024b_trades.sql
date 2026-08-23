-- ============================================================================
-- 024b_trades.sql
--
-- Card-for-card trading. Decided 2026-08-22:
--   * pure card-for-card; any value imbalance settles in FSC
--   * a flat platform fee, charged to the side RECEIVING the higher-valued
--     card; on a tie, the initiator pays
--   * valuation from fn_card_value_cents (SKU oracle x float multiplier)
--   * no Stripe cash boot - that is 025, and the cash portion will carry the
--     standard proportional commission so a sale cannot be arbitraged into a
--     "trade" by attaching a worthless card
--
-- WHY TRADING EXISTS: without a fee on ownership transfer by trade, platform
-- income decays toward zero as the product succeeds - people trade instead of
-- selling and nothing is charged.
--
-- DEPENDS ON: 024a (trade_credit_gross, trade_credit_net).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Offers
-- ---------------------------------------------------------------------------
create table if not exists trade_offers (
  id                 uuid primary key default gen_random_uuid(),
  initiator_id       uuid not null references users(id),
  recipient_id       uuid not null references users(id),
  offered_card_id    uuid not null references cards(id),  -- initiator gives
  requested_card_id  uuid not null references cards(id),  -- initiator wants
  status             text not null default 'open',
  -- Terms are LOCKED at offer time. Oracle prices move; an offer accepted
  -- three days later must settle on what both parties actually agreed to,
  -- not on a number that drifted underneath them.
  offered_value_cents   bigint not null,
  requested_value_cents bigint not null,
  imbalance_cents    bigint not null default 0,
  fee_cents          bigint not null default 0,
  payer_id           uuid references users(id),  -- owes imbalance + fee
  hold_id            uuid references credit_holds(id),
  parent_offer_id    uuid references trade_offers(id),
  expires_at         timestamptz not null,
  resolved_at        timestamptz,
  txn_id             uuid,
  note               text,
  created_at         timestamptz not null default now(),
  constraint trade_offers_status_check check (
    status in ('open','accepted','declined','cancelled','expired','countered')
  ),
  constraint trade_offers_distinct_cards check (offered_card_id <> requested_card_id),
  constraint trade_offers_distinct_parties check (initiator_id <> recipient_id)
);

create index if not exists trade_offers_open_idx
  on trade_offers (recipient_id, status) where status = 'open';
create index if not exists trade_offers_expiry_idx
  on trade_offers (expires_at) where status = 'open';

-- One open offer per card pair per initiator. Spamming the same swap at
-- someone is harassment, not liquidity.
create unique index if not exists trade_offers_one_open_uidx
  on trade_offers (initiator_id, offered_card_id, requested_card_id)
  where status = 'open';

alter table trade_offers enable row level security;

drop policy if exists trade_offers_read_own on trade_offers;
create policy trade_offers_read_own on trade_offers
  for select to authenticated
  using (
    initiator_id = fn_current_user_id()
    or recipient_id = fn_current_user_id()
    or fn_is_admin()
  );

-- ---------------------------------------------------------------------------
-- 2. Let credit_holds hold against an offer as well as a listing
--
-- CAREFUL: credit_holds_active_uidx is UNIQUE (user_id, listing_id) WHERE
-- status = 'active'. Making listing_id nullable would silently defeat it for
-- trade holds, because NULLs never collide in a unique index - one user could
-- stack unlimited active holds against the same FSC, each passing the balance
-- check on its own. It is replaced with two partial indexes, one per kind.
-- ---------------------------------------------------------------------------
alter table credit_holds alter column listing_id drop not null;

alter table credit_holds
  add column if not exists offer_id uuid references trade_offers(id);

alter table credit_holds
  drop constraint if exists credit_holds_one_subject;
alter table credit_holds
  add constraint credit_holds_one_subject check (
    (listing_id is not null and offer_id is null)
    or (listing_id is null and offer_id is not null)
  );

drop index if exists credit_holds_active_uidx;

create unique index if not exists credit_holds_active_listing_uidx
  on credit_holds (user_id, listing_id)
  where status = 'active' and listing_id is not null;

create unique index if not exists credit_holds_active_offer_uidx
  on credit_holds (user_id, offer_id)
  where status = 'active' and offer_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Config
-- ---------------------------------------------------------------------------
insert into platform_config (key, num_value, note) values
  ('trade_fee_cents', 200,
   'Flat fee in USD cents on a card-for-card trade, charged to the side '
   'receiving the higher-valued card; on a tie, the initiator. Flat rather '
   'than proportional keeps it simple, but see the note on 025: once a cash '
   'boot exists, the cash portion MUST carry the normal proportional '
   'commission or every sale gets restructured as a trade to dodge it.'),
  ('trade_offer_ttl_hours', 72,
   'How long an open trade offer stands. Without a TTL a stale offer gets '
   'accepted weeks later on terms nobody remembers agreeing to, against FSC '
   'that has since been spent.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Quote: who owes what
--
-- Pure function, no writes. The UI can call it to show terms before anyone
-- commits, and fn_create_trade_offer uses it so the quoted number and the
-- stored number cannot drift apart.
-- ---------------------------------------------------------------------------
create or replace function fn_trade_quote(
  p_offered_card_id uuid, p_requested_card_id uuid, p_initiator_id uuid
) returns table (
  offered_value_cents   bigint,
  requested_value_cents bigint,
  imbalance_cents       bigint,
  fee_cents             bigint,
  payer_id              uuid
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_off  bigint;
  v_req  bigint;
  v_recip uuid;
  v_fee  bigint;
begin
  v_off := fn_card_value_cents(p_offered_card_id);
  v_req := fn_card_value_cents(p_requested_card_id);
  select owner_id into v_recip from cards where id = p_requested_card_id;
  v_fee := coalesce(fn_config_num('trade_fee_cents'), 0);

  return query select
    v_off,
    v_req,
    abs(v_req - v_off),
    v_fee,
    case
      when v_req > v_off then p_initiator_id  -- initiator receives more
      when v_off > v_req then v_recip         -- recipient receives more
      else p_initiator_id                     -- tie: initiator pays
    end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Create an offer
--
-- Runs as the initiator's session. If the initiator is the one who owes, their
-- FSC is RESERVED now - same reasoning as checkout: an amount that is merely
-- checked can be spent elsewhere before settlement. If the RECIPIENT owes, no
-- hold is taken: they have not agreed to anything yet, and their balance is
-- verified inside the accept transaction, which settles atomically.
-- ---------------------------------------------------------------------------
create or replace function fn_create_trade_offer(
  p_offered_card_id uuid, p_requested_card_id uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user    uuid;
  v_off     cards%rowtype;
  v_req     cards%rowtype;
  v_q       record;
  v_owed    bigint;
  v_avail   bigint;
  v_hours   bigint;
  v_minutes bigint;
  v_offer   uuid;
  v_hold    uuid;
begin
  v_user := fn_current_user_id();
  if v_user is null then raise exception 'sign in to make a trade offer'; end if;

  select * into v_off from cards where id = p_offered_card_id for update;
  if not found then raise exception 'card % not found', p_offered_card_id; end if;
  select * into v_req from cards where id = p_requested_card_id for update;
  if not found then raise exception 'card % not found', p_requested_card_id; end if;

  if v_off.owner_id <> v_user then
    raise exception 'you do not own card %', p_offered_card_id;
  end if;
  if v_req.owner_id = v_user then
    raise exception 'cannot trade with yourself';
  end if;

  -- 'active' excludes pending_vault (the shoe has not reached the vault, so
  -- the card must not move on) and 'locked' (a live listing). This is the
  -- whole point of the custody model in 023c - name it, do not assume it.
  if v_off.status <> 'active' then
    raise exception 'your card is %, expected active', v_off.status;
  end if;
  if v_req.status <> 'active' then
    raise exception 'their card is %, expected active', v_req.status;
  end if;

  if (select is_restricted from users where id = v_user) then
    raise exception 'your account is restricted';
  end if;
  if (select is_restricted from users where id = v_req.owner_id) then
    raise exception 'that account is restricted';
  end if;

  select * into v_q from fn_trade_quote(p_offered_card_id, p_requested_card_id, v_user);
  v_hours := coalesce(fn_config_num('trade_offer_ttl_hours'), 72);

  insert into trade_offers (
    initiator_id, recipient_id, offered_card_id, requested_card_id,
    offered_value_cents, requested_value_cents, imbalance_cents, fee_cents,
    payer_id, expires_at)
  values (
    v_user, v_req.owner_id, p_offered_card_id, p_requested_card_id,
    v_q.offered_value_cents, v_q.requested_value_cents, v_q.imbalance_cents,
    v_q.fee_cents, v_q.payer_id,
    now() + make_interval(hours => v_hours::int))
  returning id into v_offer;

  if v_q.payer_id = v_user then
    v_owed := v_q.imbalance_cents + v_q.fee_cents;
    if v_owed > 0 then
      perform fn_expire_credit_holds();
      perform 1 from users where id = v_user for update;

      v_avail := fn_credit_available(v_user);
      if v_avail < v_owed then
        raise exception
          'insufficient available FSC: % available, % needed (% imbalance + % fee)',
          v_avail, v_owed, v_q.imbalance_cents, v_q.fee_cents;
      end if;

      v_minutes := coalesce(fn_config_num('credit_hold_minutes'), 30);
      -- Held for the life of the OFFER, not the checkout window: the
      -- counterparty may take days to answer.
      insert into credit_holds (user_id, listing_id, offer_id, amount_cents, expires_at)
      values (v_user, null, v_offer, v_owed,
              now() + make_interval(hours => v_hours::int))
      returning id into v_hold;

      update trade_offers set hold_id = v_hold where id = v_offer;
    end if;
  end if;

  return v_offer;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Accept - the whole swap, atomically
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

  -- Ownership can have changed since the offer was made.
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

  -- Serialise the payer, then verify. If the payer is the initiator a hold
  -- already covers it; fn_credit_available subtracts active holds, so add the
  -- held amount back before comparing or the payer's own reservation looks
  -- like someone else's claim.
  perform 1 from users where id = v_o.payer_id for update;
  if v_owed > 0 then
    v_avail := fn_credit_available(v_o.payer_id);
    if v_o.hold_id is not null then
      v_avail := v_avail + coalesce(
        (select amount_cents from credit_holds
          where id = v_o.hold_id and status = 'active'), 0);
    end if;
    if v_avail < v_owed then
      raise exception 'the paying side no longer has % FSC available', v_owed;
    end if;
  end if;

  -- FSC: imbalance moves peer to peer.
  if v_o.imbalance_cents > 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn,'trade_credit_gross','credit', v_o.payer_id, false,
            v_o.imbalance_cents, -1),
           (v_txn,'trade_credit_net','credit', v_payee, false,
            v_o.imbalance_cents, 1);
  end if;

  -- FSC: the flat fee, to the platform. Both legs carry 'trade_fee', so the
  -- type nets to zero and revenue is the is_platform side only.
  if v_o.fee_cents > 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn,'trade_fee','credit', v_o.payer_id, false, v_o.fee_cents, -1),
           (v_txn,'trade_fee','credit', null,         true,  v_o.fee_cents,  1);
  end if;

  -- Cards: four legs, two per card. The 023c constraint trigger checks each
  -- card_id nets to zero within the transaction.
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

  -- Any other open offer involving either card is now unfulfillable.
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
-- 7. Decline / cancel / counter / expire
-- ---------------------------------------------------------------------------
create or replace function fn_resolve_trade_offer(p_offer_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := fn_current_user_id();
  v_o    trade_offers%rowtype;
begin
  if p_status not in ('declined','cancelled') then
    raise exception 'unsupported resolution %', p_status;
  end if;

  select * into v_o from trade_offers where id = p_offer_id for update;
  if not found then raise exception 'offer % not found', p_offer_id; end if;
  if v_o.status <> 'open' then
    raise exception 'offer % is %', p_offer_id, v_o.status;
  end if;

  -- The recipient declines; the initiator withdraws.
  if p_status = 'declined' and v_o.recipient_id <> v_user and not fn_is_admin() then
    raise exception 'offer % was not made to you', p_offer_id;
  end if;
  if p_status = 'cancelled' and v_o.initiator_id <> v_user and not fn_is_admin() then
    raise exception 'offer % is not yours to withdraw', p_offer_id;
  end if;

  update trade_offers set status = p_status, resolved_at = now()
   where id = p_offer_id;

  -- Release the reservation, or the FSC stays stuck until the TTL runs out.
  if v_o.hold_id is not null then
    update credit_holds set status = 'released', released_at = now()
     where id = v_o.hold_id and status = 'active';
  end if;
end $$;

create or replace function fn_expire_trade_offers()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  with x as (
    update trade_offers set status = 'expired', resolved_at = now()
     where status = 'open' and expires_at <= now()
     returning hold_id
  )
  update credit_holds set status = 'released', released_at = now()
   where id in (select hold_id from x where hold_id is not null)
     and status = 'active';

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
revoke execute on function fn_trade_quote(uuid, uuid, uuid)     from public, anon;
revoke execute on function fn_create_trade_offer(uuid, uuid)    from public, anon;
revoke execute on function fn_accept_trade_offer(uuid)          from public, anon;
revoke execute on function fn_resolve_trade_offer(uuid, text)   from public, anon;
revoke execute on function fn_expire_trade_offers()             from public, anon, authenticated;

grant execute on function fn_trade_quote(uuid, uuid, uuid)      to authenticated;
grant execute on function fn_create_trade_offer(uuid, uuid)     to authenticated;
grant execute on function fn_accept_trade_offer(uuid)           to authenticated;
grant execute on function fn_resolve_trade_offer(uuid, text)    to authenticated;
grant execute on function fn_expire_trade_offers()              to service_role;

-- ---------------------------------------------------------------------------
-- 9. Assertions
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
    raise exception '024b: % function(s) now have multiple arities', v_dupes;
  end if;

  -- the replacement hold indexes must both exist, or trade holds can stack
  if not exists (select 1 from pg_indexes where schemaname='public'
                 and indexname='credit_holds_active_listing_uidx') then
    raise exception '024b: credit_holds_active_listing_uidx missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                 and indexname='credit_holds_active_offer_uidx') then
    raise exception '024b: credit_holds_active_offer_uidx missing';
  end if;
  if exists (select 1 from pg_indexes where schemaname='public'
             and indexname='credit_holds_active_uidx') then
    raise exception '024b: the old credit_holds_active_uidx still exists';
  end if;

  -- every existing hold must satisfy the new one-subject constraint
  if exists (select 1 from credit_holds
             where (listing_id is null) = (offer_id is null)) then
    raise exception '024b: existing credit_holds violate credit_holds_one_subject';
  end if;

  raise notice '024b ok: trade offers, FSC settlement, flat fee, hold indexes split';
end $$;

commit;
