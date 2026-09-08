-- ============================================================================
-- 034_fix_function_search_paths.sql
-- Add SET search_path = 'public' to all functions missing it
-- RUN IN: Supabase SQL Editor, "Run without RLS"
-- ============================================================================

BEGIN;

-- Auto-fix all functions in public schema without search_path
DO $$
DECLARE
  f oid;
  fixed_count integer := 0;
  skipped_count integer := 0;
BEGIN
  FOR f IN 
    SELECT oid FROM pg_proc 
    WHERE pronamespace = 'public'::regnamespace
    AND proconfig IS NULL  -- no search_path set
    AND prokind = 'f'      -- functions only, not procedures
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = ''public''', f::regprocedure);
      fixed_count := fixed_count + 1;
    EXCEPTION WHEN OTHERS THEN
      skipped_count := skipped_count + 1;
      RAISE NOTICE 'Skipped %: %', f::regprocedure, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Auto-fixed % functions, skipped %', fixed_count, skipped_count;
END $$;

-- Explicitly fix critical admin functions using dynamic SQL
DO $$
DECLARE
  func_sig text;
  v_err text;
BEGIN
  FOR func_sig IN
    SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
    AND p.prokind = 'f'
    AND p.proname IN (
      'fn_approve_submission', 'fn_list_card', 'fn_current_user_id', 'fn_is_admin',
      'fn_require_admin', 'fn_require_actor', 'fn_purchase_card', 'fn_cancel_listing',
      'fn_mint_card', 'fn_burn_card', 'fn_redeem_card', 'fn_submit_listing',
      'fn_advance_consignment', 'fn_authenticate_item', 'fn_grade_item', 'fn_reject_item',
      'fn_reject_submission', 'fn_confirm_shipment', 'fn_mark_shipped', 'fn_record_proof',
      'fn_set_item_photos', 'fn_create_sku_model', 'fn_archive_sku_model', 'fn_ensure_sku_variant',
      'fn_create_trade_offer', 'fn_accept_trade_offer', 'fn_resolve_trade_offer', 'fn_trade_quote',
      'fn_credit_balance', 'fn_credit_available', 'fn_credit_held', 'fn_purchase_credit',
      'fn_reserve_credit', 'fn_release_credit_hold', 'fn_payout_method_for_user', 'fn_record_sweep',
      'fn_check_solvency', 'fn_platform_position', 'fn_set_country', 'fn_mark_default',
      'fn_confirm_sale_cancellation', 'fn_award_xp', 'fn_float_multiplier', 'fn_tier_for_sku',
      'fn_tier_for_price', 'fn_grade_for_float', 'fn_card_value_cents', 'fn_config_bool',
      'fn_config_num', 'fn_guard_sku_art_url', 'fn_guard_sku_model_art_url', 'fn_sync_condition_grade',
      'fn_refresh_float_percentiles', 'fn_refresh_levels', 'fn_block_sweep_mutation',
      'fn_mark_notification_read', 'fn_vault_mark_shipped', 'fn_vault_receive', 'fn_vault_mark_defaulted',
      'fn_require_self_or_admin',
      'trg_ledger_balanced', 'trg_ledger_card_balanced', 'trg_ledger_credit_balanced',
      'trg_ledger_immutable', 'trg_sku_variant_derive', 'trg_users_id_matches_auth', 'trg_sku_model_propagate'
    )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = ''public''', func_sig);
    EXCEPTION WHEN undefined_function THEN
      -- function doesn't exist, skip
      NULL;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      RAISE NOTICE 'Failed to alter %: %', func_sig, v_err;
    END;
  END LOOP;
END $$;

COMMIT;

-- Verify
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proconfig IS NULL
    AND prokind = 'f';
  RAISE NOTICE 'Functions still missing search_path: %', v_count;
END $$;