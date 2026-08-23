-- ============================================================================
-- 024c_fix_trade_accept_balance_read.sql
--
-- Fixes a collision between 022b and 024b, found by scripts/smoke_settlement.sql.
--
-- THE BUG
-- fn_accept_trade_offer runs as the RECIPIENT's session, but has to verify the
-- PAYER's FSC before settling - and when the initiator is the payer, that is
-- somebody else's balance. 022b's fn_require_self_or_admin refuses it:
--     not authorised to read another user's balance
-- Settlement therefore fails on every trade where the initiator owes.
--
-- THE FIX, AND WHAT IT IS NOT
-- The guard is correct and stays. An authenticated user must not be able to
-- read another user's balance by calling the RPC, and relaxing that to make a
-- trade work would trade a real protection for a convenience.
--
-- Instead: an UNCHECKED reader that no client role can call. It carries no
-- grant to anon, authenticated or service_role, so the only way to reach it is
-- from inside a SECURITY DEFINER function owned by the same role - which is
-- exactly the context that has already established who is allowed to do what.
--
-- The pattern to keep: guarded readers are the public surface; unguarded ones
-- are internal and must never be granted. If a future migration grants
-- fn_credit_available_unchecked to anything, it has undone 022b.
--
-- DEPENDS ON: 022b (the guard), 024b (the function being replaced).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Internal, unguarded balance readers
-- ---------------------------------------------------------------------------
create or replace function fn_credit_available_unchecked(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    coalesce((
      select sum(amount_cents * direction)
        from ledger_entries
       where account_id = p_user and asset = 'credit'
    ), 0)::bigint
    -
    coalesce((
      select sum(amount_cents)
        from credit_holds
       where user_id = p_user
         and status = 'active'
         and expires_at > now()
    ), 0)::bigint;
$$;

comment on function fn_credit_available_unchecked(uuid) is
  'INTERNAL. Same arithmetic as fn_credit_available with no self-or-admin '
  'guard. Deliberately granted to NO role - reachable only from SECURITY '
  'DEFINER functions owned by this role. Granting it to any client role undoes '
  '022b.';

revoke execute on function fn_credit_available_unchecked(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. fn_accept_trade_offer, with the one changed line
--
-- Unchanged apart from the balance read. Reissued in full because Postgres has
-- no way to patch a function body.
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
    -- CHANGED (024c): the guarded fn_credit_available refuses this read when
    -- the payer is the initiator, because the caller is the recipient.
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

  if v_o.fee_cents > 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn,'trade_fee','credit', v_o.payer_id, false, v_o.fee_cents, -1),
           (v_txn,'trade_fee','credit', null,         true,  v_o.fee_cents,  1);
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
-- 3. Assertions
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
    raise exception '024c: % function(s) now have multiple arities', v_dupes;
  end if;

  -- the internal reader must be unreachable from every client role
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'),('authenticated'),('service_role')) as r(rolname)
    where n.nspname = 'public'
      and p.proname = 'fn_credit_available_unchecked'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  ) then
    raise exception
      '024c: fn_credit_available_unchecked is callable by a client role - '
      'that undoes the 022b guard';
  end if;

  -- and the guarded one must still refuse
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_require_self_or_admin'
  ) then
    raise exception '024c: fn_require_self_or_admin is missing';
  end if;

  raise notice '024c ok: internal reader added and locked, accept path fixed';
end $$;

commit;
