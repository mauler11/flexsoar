-- ============================================================================
-- 025_user_country.sql
--
-- Lets a user set their own country_code, and stops NULL from being silently
-- treated as "not Malaysian".
--
-- THE BUG THIS CLOSES, live-verified 2026-08-22:
-- a real browser signup produces users.country_code = NULL, and
-- fn_payout_method_for_user resolves NULL to 'credit'. Every launch consignor
-- is Malaysian and entitled to CASH, so today they would all be paid in FSC -
-- earned-only store credit they cannot cash out - with no error anywhere.
--
-- track/market built the capture UI (f1f08e4) but could not finish it:
-- 007_profile_updates.sql grants self-update on `handle` only, and no later
-- migration widened it. So the field validates, previews the right payout, and
-- blocks submission - then has nowhere to write.
--
-- TWO CHANGES, and the second matters more than the first.
--
-- 1. fn_set_country(p_country) - self-service, ISO alpha-2, rejects anything
--    that is not two letters. Deliberately NOT a general profile-update
--    function: widening the users update grant to arbitrary columns would let
--    a client set is_admin, level, portfolio_value_cents or is_restricted.
--    One column, one function.
--
-- 2. fn_payout_method_for_user RAISES on NULL instead of returning 'credit'.
--    NULL means "we do not know", which is not the same as "not Malaysian",
--    and the whole bug was those two being conflated. A missing country now
--    fails loudly at the one moment the user can fix it, rather than quietly
--    mispaying them weeks later.
--
-- CONSEQUENCE, deliberate: every existing user with a NULL country - which is
-- all of them except the seed rows - can no longer list or sell until they set
-- one. That is correct. A listing whose payout cannot be determined should not
-- exist. The market UI collects it on the listing screen, so a real consignor
-- hits the prompt, not the error.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Self-service country
-- ---------------------------------------------------------------------------
create or replace function fn_set_country(p_country text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid;
  v_code text;
begin
  v_user := fn_current_user_id();
  if v_user is null then
    raise exception 'sign in to set your country';
  end if;

  v_code := upper(btrim(coalesce(p_country, '')));

  -- ISO 3166-1 alpha-2. Not validated against a table on purpose: the list
  -- changes, and cash_payout_countries already decides the only thing the
  -- platform acts on. Shape is what needs enforcing here.
  if v_code !~ '^[A-Z]{2}$' then
    raise exception 'country must be a two-letter ISO country code, got %',
      coalesce(p_country, 'null');
  end if;

  update users set country_code = v_code where id = v_user;
end $$;

comment on function fn_set_country(text) is
  'Sets the calling user''s country_code. One column by design - widening the '
  'users update grant would expose is_admin, level and is_restricted to a '
  'client.';

revoke execute on function fn_set_country(text) from public, anon;
grant  execute on function fn_set_country(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Unknown is not "not Malaysian"
-- ---------------------------------------------------------------------------
create or replace function fn_payout_method_for_user(p_user uuid)
returns payout_method
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_country text;
  v_claims  text;
  v_role    text;
begin
  -- self-or-admin, same shape as 021 made it and 022c fixed
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  if v_claims is not null then
    begin
      v_role := coalesce(v_claims::jsonb ->> 'role', '');
    exception when others then
      raise exception 'not authorised: session claims could not be read';
    end;
    if v_role in ('anon', 'authenticated') then
      if fn_current_user_id() is distinct from p_user and not fn_is_admin() then
        raise exception 'not authorised to read another user''s payout method';
      end if;
    end if;
  end if;

  select country_code into v_country from users where id = p_user;

  -- The change. Previously this fell through to 'credit', which is why a
  -- Malaysian consignor with no country on file would have been paid in FSC.
  if v_country is null or btrim(v_country) = '' then
    raise exception
      'user % has no country on file, so their payout cannot be determined - '
      'set one before listing', p_user;
  end if;

  return case
    when exists (
      select 1 from cash_payout_countries
       where country_code = upper(btrim(v_country))
    ) then 'cash'::payout_method
    else 'credit'::payout_method
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes int;
  v_nulls int;
begin
  select count(*) into v_dupes from (
    select proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
    group by proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '025: % function(s) now have multiple arities', v_dupes;
  end if;

  if has_function_privilege('anon',
       'public.fn_set_country(text)'::regprocedure, 'EXECUTE') then
    raise exception '025: anon can execute fn_set_country';
  end if;

  -- Report the blast radius rather than hiding it: these users cannot list
  -- until they set a country.
  select count(*) into v_nulls from users
   where country_code is null or btrim(country_code) = '';
  raise notice
    '025 ok: % user(s) have no country on file and must set one before listing',
    v_nulls;
end $$;

commit;

-- ============================================================================
-- After running, check who is affected:
--
--   select handle, country_code, is_consignor
--   from users
--   where country_code is null or btrim(country_code) = ''
--   order by created_at;
--
-- And note: tests/invariants.test.ts currently asserts that NULL resolves to
-- 'credit' ("resolves MY to cash and everything else — including null — to
-- credit"). That test was correct about the OLD behaviour and is now wrong.
-- It must be updated to assert the raise, not deleted.
-- ============================================================================
