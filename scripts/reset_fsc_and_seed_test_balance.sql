-- ============================================================================
-- scripts/reset_fsc_and_seed_test_balance.sql
--
-- Two things, in one transaction:
--   1. Reverse ALL outstanding FSC — the 21,960 of legacy top-up credit that
--      has no cash behind it. Held by seed accounts, issued by the dead
--      fn_purchase_credit path.
--   2. Issue a test FSC balance to one named account so the FSC checkout path
--      can be exercised end to end.
--
-- APPEND-ONLY, NOT DELETES. ledger_no_update blocks deletes and updates on
-- ledger_entries, and that is the right discipline: a correcting transaction
-- that offsets the original leaves both visible. Deleting would erase the
-- evidence of what happened.
--
-- ENTRY TYPE: platform_credit_settle. Credit-pinned by 024e's asset partition,
-- present since 011, and unused — it means "the platform adjusted credit
-- directly", which is exactly what this is. Deliberately NOT credit_purchase:
-- that type means a top-up, the model is dead, and reusing it would make this
-- correction look like the very thing it is correcting.
--
-- ⚠ THE TEST GRANT RECREATES UNCOLLATERALISED FSC. Cash never entered the pool
-- for it, so fn_check_solvency will report against it exactly as it does for
-- the legacy balance. That is acceptable in Stripe TEST MODE and must be
-- reversed before live keys. Section 3 below is the reversal, kept commented.
--
-- EDIT THE TWO SETTINGS AT THE TOP, then run in the Supabase SQL editor,
-- "Run without RLS".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- SETTINGS
-- ---------------------------------------------------------------------------
create temporary table _cfg on commit drop as
select
  'handla'::text as test_handle,   -- who gets the test FSC
  50000::bigint  as test_cents;    -- 50000 cents = 500.00 FSC

-- ---------------------------------------------------------------------------
-- Before
-- ---------------------------------------------------------------------------
select u.handle, fn_credit_balance(u.id) as fsc_cents_before
from users u
where fn_credit_balance(u.id) <> 0
order by 2 desc;

select fn_credit_liability() as liability_before;

-- ---------------------------------------------------------------------------
-- 1. Reverse every outstanding balance
-- ---------------------------------------------------------------------------
do $$
declare
  r     record;
  v_txn uuid := gen_random_uuid();
  v_n   int := 0;
begin
  for r in
    select u.id, u.handle, fn_credit_balance(u.id) as bal
    from users u
    where fn_credit_balance(u.id) <> 0
  loop
    -- user side: remove what they hold
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn, 'platform_credit_settle', 'credit', r.id, false,
            abs(r.bal), (-sign(r.bal))::smallint);

    -- platform side: the offsetting leg, so the class still nets to zero
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn, 'platform_credit_settle', 'credit', null, true,
            abs(r.bal), sign(r.bal)::smallint);

    raise notice 'reversed % FSC cents from %', r.bal, r.handle;
    v_n := v_n + 1;
  end loop;

  raise notice 'reversed % account(s)', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Issue the test balance
-- ---------------------------------------------------------------------------
do $$
declare
  v_user  uuid;
  v_txn   uuid := gen_random_uuid();
  v_h     text;
  v_cents bigint;
begin
  select test_handle, test_cents into v_h, v_cents from _cfg;

  select id into v_user from users where handle = v_h::citext;
  if v_user is null then
    raise exception
      'no user with handle % — edit the SETTINGS block at the top', v_h;
  end if;

  insert into ledger_entries (txn_id, entry_type, asset, account_id,
                              is_platform, amount_cents, direction)
  values (v_txn, 'platform_credit_settle', 'credit', v_user, false, v_cents, 1),
         (v_txn, 'platform_credit_settle', 'credit', null,   true,  v_cents, -1);

  raise notice 'issued % FSC cents to % for testing', v_cents, v_h;
end $$;

-- ---------------------------------------------------------------------------
-- Assertions — every txn must still net to zero within its asset class
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(txn_id::text || '/' || asset::text, ', ') into v_bad
  from (
    select txn_id, asset
    from ledger_entries
    where asset <> 'card'
    group by txn_id, asset
    having coalesce(sum(amount_cents * direction), 0) <> 0
  ) x;
  if v_bad is not null then
    raise exception 'ledger no longer nets to zero for %', v_bad;
  end if;
  raise notice 'ledger still balanced';
end $$;

-- ---------------------------------------------------------------------------
-- After
-- ---------------------------------------------------------------------------
select u.handle, fn_credit_balance(u.id) as fsc_cents_after
from users u
where fn_credit_balance(u.id) <> 0
order by 2 desc;

select fn_credit_liability() as liability_after;

select coalesce(sum(amount_cents * direction), 0) as platform_currency
from ledger_entries where is_platform and asset = 'currency';

commit;

-- ============================================================================
-- Expected after: exactly one account holds FSC (the test handle, 50000), and
-- liability equals that same 50000. Platform currency is unchanged at 13540 —
-- this touches only the credit class.
--
-- Note that liability now EXCEEDS nothing it should: 13540 currency against
-- 50000 liability still reads insolvent, because the test grant has no cash
-- behind it. Correct, and expected in test mode.
--
-- ---------------------------------------------------------------------------
-- 3. BEFORE GOING LIVE — reverse the test grant. Uncomment and run.
--
-- do $$
-- declare v_user uuid; v_bal bigint; v_txn uuid := gen_random_uuid();
-- begin
--   select id into v_user from users where handle = 'handla'::citext;
--   v_bal := fn_credit_balance(v_user);
--   if v_bal = 0 then raise notice 'nothing to reverse'; return; end if;
--   insert into ledger_entries (txn_id, entry_type, asset, account_id,
--                               is_platform, amount_cents, direction)
--   values (v_txn,'platform_credit_settle','credit', v_user, false, abs(v_bal),
--           (-sign(v_bal))::smallint),
--          (v_txn,'platform_credit_settle','credit', null, true, abs(v_bal),
--           sign(v_bal)::smallint);
--   raise notice 'reversed the % cent test grant', v_bal;
-- end $$;
-- ============================================================================
