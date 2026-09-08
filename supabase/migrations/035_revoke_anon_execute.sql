-- ============================================================================
-- 035_revoke_anon_execute.sql
-- Revoke EXECUTE on admin-only SECURITY DEFINER functions from anon role
-- RUN IN: Supabase SQL Editor, "Run without RLS"
-- ============================================================================

BEGIN;

-- Admin-only functions that anon should NEVER call
REVOKE EXECUTE ON FUNCTION public.fn_approve_submission(uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_list_card(uuid, uuid, integer, payout_method, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_current_user_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_sku_model_propagate() FROM anon;

-- Also revoke from authenticated for truly admin-only functions
-- (these should only be callable by service_role or explicit admin checks)
REVOKE EXECUTE ON FUNCTION public.fn_approve_submission(uuid, integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_current_user_id() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_is_admin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sku_model_propagate() FROM authenticated;

-- Grant back to service_role (for server-side admin operations)
GRANT EXECUTE ON FUNCTION public.fn_approve_submission(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_list_card(uuid, uuid, integer, payout_method, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_current_user_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sku_model_propagate() TO service_role;

COMMIT;

-- Verify
DO $$
DECLARE
  v_func text;
  v_priv text;
BEGIN
  FOR v_func, v_priv IN
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', a.privilege_type
    FROM information_schema.routine_privileges a
    JOIN pg_proc p ON p.oid = a.specific_name::regprocedure::oid
    WHERE p.pronamespace = 'public'::regnamespace
      AND a.grantee IN ('anon', 'authenticated')
      AND a.privilege_type = 'EXECUTE'
      AND p.proname IN ('fn_approve_submission', 'fn_list_card', 'fn_current_user_id', 'fn_is_admin', 'trg_sku_model_propagate')
  LOOP
    RAISE NOTICE '% still has EXECUTE for %', v_func, v_priv;
  END LOOP;
END $$;