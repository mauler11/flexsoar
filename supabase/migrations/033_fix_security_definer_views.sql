-- ============================================================================
-- 033_fix_security_definer_views.sql
-- Fix SECURITY DEFINER views to use SECURITY INVOKER
-- RUN IN: Supabase SQL Editor, "Run without RLS"
-- ============================================================================

BEGIN;

-- Fix public_profiles view
ALTER VIEW public.public_profiles SET (security_invoker = true);

-- Fix items_proof_overdue view
ALTER VIEW public.items_proof_overdue SET (security_invoker = true);

-- Verify
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_viewdef(oid) INTO v_def
  FROM pg_class
  WHERE relname = 'public_profiles' AND relnamespace = 'public'::regnamespace;
  IF v_def NOT ILIKE '%security_invoker%' THEN
    RAISE NOTICE 'public_profiles: security_invoker not found in definition';
  ELSE
    RAISE NOTICE 'public_profiles: OK';
  END IF;

  SELECT pg_get_viewdef(oid) INTO v_def
  FROM pg_class
  WHERE relname = 'items_proof_overdue' AND relnamespace = 'public'::regnamespace;
  IF v_def NOT ILIKE '%security_invoker%' THEN
    RAISE NOTICE 'items_proof_overdue: security_invoker not found in definition';
  ELSE
    RAISE NOTICE 'items_proof_overdue: OK';
  END IF;
END $$;

COMMIT;