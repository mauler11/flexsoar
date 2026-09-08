-- ============================================================================
-- 039_restore_policy_helper_grants.sql
--
-- Undoes the harmful part of 035. 035 revoked EXECUTE on policy helpers
-- (fn_current_user_id, fn_is_admin) from anon/authenticated to silence the
-- Supabase advisor. That broke the site: a policy expression is evaluated
-- AS THE QUERYING ROLE, so e.g. notifications_own_read
--   using (user_id = fn_current_user_id())
-- raises 42501 for every read when the querying role cannot execute the
-- helper. This is the exact regression 026b documents ("signed-out home
-- page 500'd on getListings -> permission denied for function
-- fn_current_user_id").
--
-- The advisor warnings about anon/authenticated executing SECURITY DEFINER
-- functions are FALSE POSITIVES for policy helpers: fn_current_user_id and
-- fn_is_admin resolve the CALLER's identity from auth.uid(), so an anon
-- caller gets null/false — they cannot be used to impersonate.
--
-- This migration:
--   1. Restores helper grants to anon + authenticated.
--   2. Restores fn_approve_submission to authenticated (admin session client;
--      005 says explicitly: call with SESSION client, not service-role).
--   3. Sweeps: any fn_* referenced by an RLS policy gets granted to both
--      roles (same logic as 026b section 2).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Explicit helper grants (idempotent)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_current_user_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_config_num(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_config_bool(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_card_value_cents(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tier_for_price(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_grade_for_float(numeric) TO anon, authenticated;

-- fn_float_multiplier has 2 args (uuid, numeric) per 026b
GRANT EXECUTE ON FUNCTION public.fn_float_multiplier(uuid, numeric) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Admin RPC via session client must stay callable by authenticated admins.
--    The function itself checks fn_require_admin() internally.
--    (DO NOT grant to anon.)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_approve_submission(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_card(uuid, uuid, integer, payout_method, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sweep: anything an RLS policy names must be callable by both roles
--    (same as 026b section 2 — self-maintaining)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r       record;
  v_names text;
  v_n     int := 0;
BEGIN
  SELECT string_agg(
           COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
           COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
           ' ')
    INTO v_names
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public';

  IF v_names IS NULL THEN
    RAISE NOTICE '039: no RLS policies found — nothing to sweep';
    RETURN;
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'fn\_%'
      AND v_names LIKE '%' || p.proname || '%'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    RAISE NOTICE '039: granted % (referenced by an RLS policy)', r.proname;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE '039: swept % policy helper(s)', v_n;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. Assertions (outside txn so results are visible even on notice)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_missing
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN LATERAL (
    SELECT string_agg(
             COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
             COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
             ' ') AS names
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n2 ON n2.oid = c.relnamespace
    WHERE n2.nspname = 'public'
  ) s ON true
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'fn\_%'
    AND COALESCE(s.names, '') LIKE '%' || p.proname || '%'
    AND NOT (has_function_privilege('anon', p.oid, 'EXECUTE')
             AND has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      '039: RLS policies reference function(s) the querying role cannot '
      'execute: %', v_missing;
  END IF;

  RAISE NOTICE '039 ok: policy helpers reachable by anon + authenticated';
END $$;
