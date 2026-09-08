-- ============================================================================
-- 038_grant_fn_is_admin.sql
-- Grant EXECUTE on fn_is_admin to anon and authenticated (required for RLS policies)
-- RUN IN: Supabase SQL Editor, "Run without RLS"
-- ============================================================================

BEGIN;

-- fn_is_admin() is called by RLS policies (users_admin_read, consignments_read, etc.)
-- Must be executable by both anon (public pages) and authenticated (logged-in users)
GRANT EXECUTE ON FUNCTION public.fn_is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.fn_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_admin() TO service_role;

COMMIT;

-- Verify
DO $$
DECLARE
  v_anon boolean;
  v_auth boolean;
BEGIN
  SELECT has_function_privilege('anon', 'public.fn_is_admin'::regprocedure, 'EXECUTE') INTO v_anon;
  SELECT has_function_privilege('authenticated', 'public.fn_is_admin'::regprocedure, 'EXECUTE') INTO v_auth;
  RAISE NOTICE 'fn_is_admin EXECUTE: anon=%, authenticated=%', v_anon, v_auth;
END $$;