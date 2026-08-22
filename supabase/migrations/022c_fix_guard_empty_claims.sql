-- ============================================================================
-- 022c_fix_guard_empty_claims.sql
--
-- Fixes a bug introduced by 022b, and settles a policy question 022b left open.
--
-- THE BUG
-- fn_require_self_or_admin read the JWT role claim with:
--     current_setting('request.jwt.claims', true)::jsonb ->> 'role'
-- current_setting(..., true) returns NULL when the GUC was never set, but an
-- EMPTY STRING when it was explicitly set to ''. ''::jsonb raises 22P02, so a
-- caller that clears the claim rather than leaving it unset got a hard error
-- out of what is supposed to be a permission check. fn_credit_available
-- carries this guard, so in production it would have appeared as intermittent
-- checkout failures with a JSON parse error.
--
-- THE POLICY
-- Three states, and they are NOT the same thing:
--   claims absent      -> legitimate. The Stripe webhook (service_role), the
--                         SQL editor and migrations all have no claims.
--                         PASS THROUGH.
--   claims present     -> read the role and apply self-or-admin.
--   claims unparseable -> no legitimate caller sends malformed JSON. REFUSE.
--
-- The first draft of this migration let unparseable claims fall through, which
-- is fail-open on exactly the input an attacker controls. This version fails
-- closed. Absent still passes; garbage does not.
--
-- Same arity, so this REPLACES rather than overloads.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

create or replace function fn_require_self_or_admin(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_claims text;
  v_role   text;
begin
  -- nullif collapses "never set" and "set to empty" into one NULL case.
  v_claims := nullif(current_setting('request.jwt.claims', true), '');

  -- No claims at all: service_role, webhook, psql, migrations. Allowed --
  -- service_role can read ledger_entries directly regardless, so refusing
  -- here would break settlement without preventing anything.
  if v_claims is null then
    return;
  end if;

  -- Claims present but unreadable. Fail closed.
  begin
    v_role := coalesce(v_claims::jsonb ->> 'role', '');
  exception when others then
    raise exception 'not authorised: session claims could not be read';
  end;

  if v_role not in ('anon', 'authenticated') then
    return;
  end if;

  if fn_current_user_id() is distinct from p_user and not fn_is_admin() then
    raise exception 'not authorised to read another user''s balance';
  end if;
end $$;

comment on function fn_require_self_or_admin(uuid) is
  'Refuses an anon or authenticated caller asking about a user other than '
  'themselves. Session-less callers (service_role, migrations) pass through; '
  'unparseable claims are refused rather than waved past.';

-- ---------------------------------------------------------------------------
-- Assertions: every claim shape the guard can receive
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes int;
  v_ok    boolean;
begin
  -- 1. cleared claims must NOT raise (this is the 22P02 regression)
  perform set_config('request.jwt.claims', '', true);
  perform fn_require_self_or_admin(gen_random_uuid());
  raise notice '022c: cleared claims pass';

  -- 2. service_role passes through
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform fn_require_self_or_admin(gen_random_uuid());
  raise notice '022c: service_role passes';

  -- 3. malformed claims must be REFUSED, and with the guard's own message --
  --    not a raw 22P02 leaking out of the cast
  v_ok := false;
  begin
    perform set_config('request.jwt.claims', 'not json', true);
    perform fn_require_self_or_admin(gen_random_uuid());
  exception when others then
    if sqlerrm like '%could not be read%' then
      v_ok := true;
    else
      raise exception '022c: malformed claims raised the wrong error (%)', sqlerrm;
    end if;
  end;
  if not v_ok then
    raise exception '022c: malformed claims were ALLOWED. Guard fails open.';
  end if;
  raise notice '022c: malformed claims refused';

  -- 4. anon must be refused
  v_ok := false;
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform fn_require_self_or_admin(gen_random_uuid());
  exception when others then
    v_ok := true;
  end;
  if not v_ok then
    raise exception '022c: anon was NOT refused';
  end if;
  raise notice '022c: anon refused';

  perform set_config('request.jwt.claims', '', true);

  -- 5. no overload introduced
  select count(*) into v_dupes from (
    select proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname = 'fn_require_self_or_admin'
    group by proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '022c: fn_require_self_or_admin now has multiple arities';
  end if;

  raise notice '022c ok: absent passes, cleared passes, malformed refused, anon refused';
end $$;

commit;
