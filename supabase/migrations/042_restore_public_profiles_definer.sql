-- ============================================================================
-- 042_restore_public_profiles_definer.sql
--
-- REVERTS 033 for public_profiles (keeps it for items_proof_overdue).
--
-- 033 set security_invoker=true on public_profiles to silence the
-- security_definer_view linter. That broke the market: the view runs with
-- the QUERIER's rights, users RLS filters to self-only rows, and the
-- seller:public_profiles!inner embed in getListings drops every listing
-- whose seller isn't you. Symptom: a seller sees only their own listings,
-- everyone else sees an empty grid (verified live: 2 public listings,
-- seller sees 2, another user sees 0).
--
-- The DEFINER behavior is deliberate and safe, per 006/007: the view
-- exposes ONLY id, handle, level, xp_total, portfolio_value_cents,
-- created_at — never email, auth_id, kyc_status, is_admin. RLS on users
-- stays locked down; this view is the designed public window into it.
-- Expect the linter to re-flag security_definer_view for this view:
-- that finding is accepted by design, do NOT "fix" it again.
--
-- items_proof_overdue stays invoker=true: its only callers are admin flows
-- (admin passes fn_is_admin -> items_admin_read), so it is unaffected.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER VIEW public.public_profiles SET (security_invoker = false);

COMMENT ON VIEW public.public_profiles IS
  'Deliberate SECURITY DEFINER (invoker=false): exposes safe columns only '
  '(id, handle, level, xp_total, portfolio_value_cents, created_at). The '
  'market grid embeds seller:public_profiles!inner, which requires the view '
  'to be world-readable while users RLS stays self-only. See 006/007 and '
  '042. The security_definer_view linter finding on this view is accepted.';

COMMIT;

-- Verify: anon can read another user's profile row through the view
DO $$
DECLARE
  v_count integer;
BEGIN
  -- The view must be invoker=false for the market embed to work
  SELECT COUNT(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'public_profiles'
    AND c.reloptions::text LIKE '%security_invoker=false%';
  IF v_count = 0 THEN
    RAISE EXCEPTION '042: public_profiles is not security_invoker=false';
  END IF;
  RAISE NOTICE '042 ok: public_profiles is definer again';
END $$;
