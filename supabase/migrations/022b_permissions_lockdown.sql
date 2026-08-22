-- ============================================================================
-- 022b_permissions_lockdown.sql
--
-- Closes the grant gap found on 2026-08-22: every fn_* except fn_purchase_credit
-- still carried Postgres's default EXECUTE grant to PUBLIC, which anon and
-- authenticated inherit. Most bodies refuse a non-admin caller anyway, but
-- three of them have nothing to refuse on, and one is a dead pre-019c
-- settlement path.
--
-- Four changes:
--   1. fn_require_self_or_admin() - a guard for uuid-argument readers
--   2. Guards on fn_credit_available / fn_credit_held (both SECURITY DEFINER)
--   3. Targeted REVOKEs, then deliberate GRANTs
--   4. Drop fn_purchase_card_with_credit (pre-019c, still anon-callable)
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
--
-- ORDER: run this, then have track/data delete the purchaseCardWithCredit
-- export from lib/api/contract.ts. Nothing in app/** calls it, so the window
-- between the two is harmless.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The guard
--
-- Keying on current_user does NOT work: inside a SECURITY DEFINER function
-- current_user is already the function owner, so the check would never fire.
-- Key on the JWT role claim instead, which survives into definer context
-- because it is a GUC, not a role.
--
--   role claim 'anon'          -> no user id, so always refused
--   role claim 'authenticated' -> must be self, or an admin
--   role claim 'service_role'  -> allowed: the webhook has no session, and
--                                 service_role can read ledger_entries
--                                 directly anyway. Blocking it here is
--                                 theatre that breaks settlement.
--   no claim at all            -> allowed: psql / SQL editor / migrations
-- ---------------------------------------------------------------------------
create or replace function fn_require_self_or_admin(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  );

  if v_role not in ('anon', 'authenticated') then
    return;  -- service_role, or no session at all
  end if;

  if fn_current_user_id() is distinct from p_user and not fn_is_admin() then
    raise exception 'not authorised to read another user''s balance';
  end if;
end $$;

comment on function fn_require_self_or_admin(uuid) is
  'Refuses an anon or authenticated caller asking about a user other than '
  'themselves. Service-role and session-less callers pass through.';

-- ---------------------------------------------------------------------------
-- 2. Guard the two SECURITY DEFINER readers
--
-- fn_credit_balance is deliberately NOT guarded: it is not SECURITY DEFINER,
-- so it runs as the caller and RLS on ledger_entries already prevents reading
-- another user's rows. It is revoked from anon below instead.
--
-- Arity is unchanged on both, so these REPLACE rather than overload. The
-- assertion at the end of this file proves that.
-- ---------------------------------------------------------------------------
create or replace function fn_credit_held(p_user uuid)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform fn_require_self_or_admin(p_user);

  return coalesce((
    select sum(amount_cents)
      from credit_holds
     where user_id = p_user
       and status = 'active'
       and expires_at > now()
  ), 0)::bigint;
end $$;

create or replace function fn_credit_available(p_user uuid)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform fn_require_self_or_admin(p_user);
  -- fn_credit_held re-checks; harmless, and keeps it safe if called directly.
  return fn_credit_balance(p_user) - fn_credit_held(p_user);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Drop the pre-019c credit path
--
-- fn_purchase_card_with_credit(uuid, uuid) predates the unified settlement in
-- 019c. It carries the old model's assumptions - mutually exclusive cash and
-- credit, no settlement ref, no hold - and is SECURITY DEFINER and callable by
-- anon. 022 dropped the legacy cash overloads; this is the same class of
-- object under a different name.
-- ---------------------------------------------------------------------------
drop function if exists fn_purchase_card_with_credit(uuid, uuid);

-- ---------------------------------------------------------------------------
-- 4. Grants
--
-- Revoke from PUBLIC first - that is where the default grant lives, and
-- revoking from anon/authenticated alone leaves it in place. Then grant back
-- deliberately, per role, per function.
-- ---------------------------------------------------------------------------

-- Platform financials. fn_platform_position_raw is SECURITY DEFINER with no
-- internal guard - the guard lives only in the fn_platform_position wrapper.
-- It is called internally by fn_check_solvency and the fn_guard_sweep trigger;
-- those run as the owner and keep working without an explicit grant, so a
-- revoke here closes the anonymous RPC without touching them.
revoke execute on function fn_platform_position_raw()  from public, anon, authenticated;
revoke execute on function fn_platform_position()      from public, anon;
revoke execute on function fn_check_solvency(bigint)   from public, anon;
revoke execute on function fn_credit_liability()       from public, anon;

grant execute on function fn_platform_position()       to authenticated;
grant execute on function fn_check_solvency(bigint)    to authenticated;

-- Sweeps. Admin-only in the body; keep it that way at the grant layer too.
revoke execute on function fn_record_sweep(bigint, text, text) from public, anon;
grant  execute on function fn_record_sweep(bigint, text, text) to authenticated;

-- Credit readers.
revoke execute on function fn_credit_balance(uuid)   from public, anon;
revoke execute on function fn_credit_available(uuid) from public, anon;
revoke execute on function fn_credit_held(uuid)      from public, anon;

grant execute on function fn_credit_balance(uuid)    to authenticated;
grant execute on function fn_credit_available(uuid)  to authenticated;
grant execute on function fn_credit_held(uuid)       to authenticated;

-- Holds. reserve/release need a real session by design (021's identity guard).
-- Expiry is maintenance: service_role only, so a stranger cannot drop everyone
-- else's in-flight checkout holds by calling it in a loop.
revoke execute on function fn_reserve_credit(uuid, bigint) from public, anon;
revoke execute on function fn_release_credit_hold(uuid)    from public, anon;
revoke execute on function fn_expire_credit_holds()        from public, anon, authenticated;

grant execute on function fn_reserve_credit(uuid, bigint)  to authenticated;
grant execute on function fn_release_credit_hold(uuid)     to authenticated;
grant execute on function fn_expire_credit_holds()         to service_role;

-- Settlement. authenticated keeps it: 021 requires a session for the FSC leg.
revoke execute on function fn_purchase_card(uuid, uuid, text, bigint, uuid)      from public, anon;
revoke execute on function fn_purchase_card_core(uuid, uuid, text, bigint, uuid) from public, anon, authenticated;

grant execute on function fn_purchase_card(uuid, uuid, text, bigint, uuid)       to authenticated, service_role;
grant execute on function fn_purchase_card_core(uuid, uuid, text, bigint, uuid)  to service_role;

-- Stop new functions inheriting the PUBLIC grant. Only applies to objects
-- created by this role from here on - it does not retroactively fix anything,
-- which is why the explicit revokes above are still needed.
alter default privileges in schema public revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 5. Assertions - fail the migration rather than report a false success
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes int;
  v_leaks text;
begin
  -- no arity duplicates introduced
  select count(*) into v_dupes from (
    select proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
    group by proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '022b: % function(s) now have multiple arities', v_dupes;
  end if;

  -- the dead path is gone
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_purchase_card_with_credit'
  ) then
    raise exception '022b: fn_purchase_card_with_credit still exists';
  end if;

  -- anon can no longer reach anything sensitive
  select string_agg(p.proname, ', ') into v_leaks
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fn_platform_position_raw','fn_platform_position',
                      'fn_check_solvency','fn_credit_liability',
                      'fn_credit_balance','fn_credit_available','fn_credit_held',
                      'fn_reserve_credit','fn_release_credit_hold',
                      'fn_expire_credit_holds','fn_record_sweep',
                      'fn_purchase_card','fn_purchase_card_core')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_leaks is not null then
    raise exception '022b: anon still holds EXECUTE on %', v_leaks;
  end if;

  -- and authenticated cannot reach the raw position or the core path
  select string_agg(p.proname, ', ') into v_leaks
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fn_platform_position_raw','fn_purchase_card_core',
                      'fn_expire_credit_holds')
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_leaks is not null then
    raise exception '022b: authenticated still holds EXECUTE on %', v_leaks;
  end if;

  raise notice '022b ok: guards in place, dead path dropped, grants tightened';
end $$;

commit;

-- ============================================================================
-- Verify by hand afterwards:
--
--   select p.proname, r.rolname,
--          has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_exec
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   cross join (values ('anon'),('authenticated'),('service_role')) as r(rolname)
--   where n.nspname = 'public' and p.proname like 'fn\_%'
--   order by p.proname, r.rolname;
--
-- Then re-run scripts/smoke_settlement.sql. It must still pass end to end:
-- the guard allows session-less callers, so settlement is unaffected, and the
-- quadrants that impersonate a buyer are reading their own balances.
-- ============================================================================
