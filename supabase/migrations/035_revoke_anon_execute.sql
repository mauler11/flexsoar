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

-- Verify (simplified - just count from pg_proc directly)
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('fn_approve_submission', 'fn_list_card', 'fn_current_user_id', 'fn_is_admin', 'trg_sku_model_propagate')
    AND EXISTS (
      SELECT 1 FROM pg_proc p2
      JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
      WHERE p2.proname = p.proname
        AND n2.nspname = 'public'
        AND has_function_privilege('anon', p2.oid, 'EXECUTE')
    );
  RAISE NOTICE 'Functions still with EXECUTE for anon: %', v_count;
END $$;