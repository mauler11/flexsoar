-- ============================================================================
-- 026b_restore_policy_helper_grants.sql
--
-- Fixes a regression introduced by 026.
--
-- 026 revoked EXECUTE on every fn_* from PUBLIC and anon. That was right for
-- the RPC surface and wrong for one class of function: the helpers that RLS
-- POLICIES call.
--
-- A policy expression is evaluated AS THE QUERYING ROLE, not as the table
-- owner. So a policy reading `using (owner_id = fn_current_user_id())` needs
-- the querying role to hold EXECUTE on fn_current_user_id — including anon.
-- Without it every read of that table raises 42501 before RLS even decides
-- anything.
--
-- Observed live: the signed-out home page 500'd on
--   getListings -> permission denied for function fn_current_user_id
-- The whole public market was down for anonymous visitors.
--
-- WHY THE SMOKE SCRIPT DID NOT CATCH IT: scripts/smoke_settlement.sql runs as
-- postgres and impersonates authenticated users. Nothing in it ever loads a
-- page as anon, so a grant that only anon needs was invisible to it. The
-- anonymous path had no test at all.
--
-- This migration does two things:
--   1. Grants back the read-side helpers, so migration history matches what
--      was already patched into the live database by hand.
--   2. Adds a self-maintaining sweep: any fn_* referenced by an RLS policy
--      expression is granted to anon and authenticated, and the migration
--      ASSERTS that afterwards none is missing. A future revoke that breaks a
--      policy helper now fails here rather than on someone's home page.
--
-- The sensitive functions stay revoked — the sweep only touches functions a
-- policy actually names, and no policy names fn_platform_position_raw,
-- fn_credit_available_unchecked, fn_purchase_card_core or
-- fn_expire_credit_holds. Section 3 asserts that.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The helpers, granted explicitly
--
-- These are the ones patched live on 2026-08-24 to bring the home page back.
-- Recorded here so a replay of the migration history produces a working site.
--
-- All are reads with no side effects. fn_current_user_id and fn_is_admin are
-- SECURITY DEFINER and resolve the CALLER's identity from auth.uid(), so an
-- anon caller gets null and false — they cannot be used to impersonate.
-- ---------------------------------------------------------------------------
grant execute on function fn_current_user_id()             to anon, authenticated;
grant execute on function fn_is_admin()                    to anon, authenticated;
grant execute on function fn_config_num(text)              to anon, authenticated;
grant execute on function fn_config_bool(text)             to anon, authenticated;
grant execute on function fn_card_value_cents(uuid)        to anon, authenticated;
grant execute on function fn_tier_for_price(integer)       to anon, authenticated;
grant execute on function fn_grade_for_float(numeric)      to anon, authenticated;
grant execute on function fn_float_multiplier(uuid, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sweep: anything an RLS policy names must be callable by the roles the
--    policy applies to
-- ---------------------------------------------------------------------------
do $$
declare
  r       record;
  v_names text;
  v_n     int := 0;
begin
  -- Collect every policy expression on the schema as one text blob.
  select string_agg(
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
           ' ')
    into v_names
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public';

  if v_names is null then
    raise notice '026b: no RLS policies found — nothing to sweep';
    return;
  end if;

  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'fn\_%'
      and v_names like '%' || p.proname || '%'
  loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
    raise notice '026b: granted % (referenced by an RLS policy)', r.proname;
    v_n := v_n + 1;
  end loop;

  raise notice '026b: swept % policy helper(s)', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_leaked  text;
  v_names   text;
begin
  select string_agg(
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
           ' ')
    into v_names
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public';

  -- every policy-referenced helper is reachable by both roles
  select string_agg(p.proname, ', ') into v_missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'fn\_%'
    and coalesce(v_names, '') like '%' || p.proname || '%'
    and not (has_function_privilege('anon', p.oid, 'EXECUTE')
             and has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_missing is not null then
    raise exception
      '026b: RLS policies reference function(s) the querying role cannot '
      'execute: % — every read of those tables would raise 42501', v_missing;
  end if;

  -- and the sensitive ones are still closed to anon
  select string_agg(p.proname, ', ') into v_leaked
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fn_platform_position_raw', 'fn_credit_available_unchecked',
                      'fn_purchase_card_core', 'fn_expire_credit_holds',
                      'fn_record_sweep', 'fn_purchase_credit')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_leaked is not null then
    raise exception '026b: anon can execute sensitive function(s) %', v_leaked;
  end if;

  raise notice '026b ok: policy helpers reachable, sensitive surface still closed';
end $$;

commit;

-- ============================================================================
-- AFTER RUNNING: load the site SIGNED OUT and open the market. That is the
-- path nothing tests — the smoke script runs as postgres and impersonates
-- authenticated users, so an anon-only grant gap is invisible to it.
--
-- Worth adding to the checklist before any future grant change:
--   1. run scripts/smoke_settlement.sql
--   2. load / in a private window, signed out
--   3. load /card/<id> signed out
-- Step 1 alone would have shipped this bug.
-- ============================================================================
