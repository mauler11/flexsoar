-- ============================================================================
-- 024f_release_hold_service_role.sql
--
-- Lets the Stripe webhook release one specific FSC hold.
--
-- THE PROBLEM, in two halves that combined into a real one:
--
--   1. 022b revoked the default PUBLIC execute grant on fn_release_credit_hold
--      and granted only `authenticated`, so service_role lost it entirely.
--   2. Even with the grant, the body would refuse: it compares the hold owner
--      against fn_current_user_id(), and the webhook has no auth.uid(), so
--      that is null and the check fires.
--
-- Which made checkout.session.expired unable to release the abandoned hold.
-- The webhook fell back to expireCreditHolds(), a global sweep of holds already
-- past expires_at - and since credit_hold_minutes was just raised to 1440 to
-- outlast Stripe's webhook retries, an abandoned hold is not due for 24 hours.
-- Net effect: a buyer who walks away from checkout has their FSC locked for a
-- full day. The two changes silently cancelled each other.
--
-- THE FIX: the same carve-out shape as 022c's fn_require_self_or_admin.
--   role claim 'anon' / 'authenticated' -> must own the hold, or be admin
--   service_role, or no claims at all   -> allowed
--   claims present but unparseable      -> refused
--
-- Allowing session-less callers is not a loosening in substance: service_role
-- can already update credit_holds directly, so refusing it at the RPC blocks
-- the legitimate webhook without stopping anything.
--
-- DEPENDS ON: 021 (the function), 022b (the grants), 022c (the guard pattern).
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

create or replace function fn_release_credit_hold(p_hold_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_h      credit_holds%rowtype;
  v_claims text;
  v_role   text;
begin
  select * into v_h from credit_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold % not found', p_hold_id;
  end if;

  v_claims := nullif(current_setting('request.jwt.claims', true), '');

  if v_claims is not null then
    begin
      v_role := coalesce(v_claims::jsonb ->> 'role', '');
    exception when others then
      raise exception 'not authorised: session claims could not be read';
    end;

    -- Only a real client session has to prove ownership. The webhook and
    -- migrations have no claims and pass through.
    if v_role in ('anon', 'authenticated') then
      if v_h.user_id is distinct from fn_current_user_id() and not fn_is_admin() then
        raise exception 'hold % does not belong to you', p_hold_id;
      end if;
    end if;
  end if;

  if v_h.status <> 'active' then
    return;  -- already consumed, released or expired; releasing again is a no-op
  end if;

  update credit_holds
     set status = 'released', released_at = now()
   where id = p_hold_id;
end $$;

comment on function fn_release_credit_hold(uuid) is
  'Releases one FSC hold. A client session must own it or be admin; the Stripe '
  'webhook (service_role, no claims) may release any hold, which is what makes '
  'checkout.session.expired return a buyer''s FSC promptly instead of waiting '
  'out the 24h TTL.';

revoke execute on function fn_release_credit_hold(uuid) from public, anon;
grant  execute on function fn_release_credit_hold(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_release_credit_hold'
    group by proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '024f: fn_release_credit_hold now has multiple arities';
  end if;

  if not has_function_privilege('service_role',
       'public.fn_release_credit_hold(uuid)'::regprocedure, 'EXECUTE') then
    raise exception '024f: service_role still cannot execute fn_release_credit_hold';
  end if;
  if has_function_privilege('anon',
       'public.fn_release_credit_hold(uuid)'::regprocedure, 'EXECUTE') then
    raise exception '024f: anon can execute fn_release_credit_hold';
  end if;

  raise notice '024f ok: the webhook can release a specific hold; clients still cannot release others''';
end $$;

commit;
