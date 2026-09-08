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
  RAISE NOTICE 'Fixed % functions, skipped %', fixed_count, skipped_count;
END $$;

-- Explicitly fix critical admin functions (in case auto-fix missed any)
ALTER FUNCTION IF EXISTS public.fn_approve_submission(uuid, integer, integer) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_list_card(uuid, uuid, integer, payout_method, integer) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_current_user_id() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_is_admin() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_require_admin() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_require_actor(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_purchase_card(uuid, uuid, text, bigint, uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_cancel_listing(uuid, uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_mint_card(uuid, uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_burn_card(uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_redeem_card(uuid, uuid, jsonb, integer) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_submit_listing(uuid, integer, payout_method, jsonb, numeric, numeric, numeric, numeric, numeric, numeric, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_advance_consignment(uuid, consignment_status, uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_authenticate_item(uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_grade_item(uuid, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_reject_item(uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_reject_submission(uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_confirm_shipment(uuid, text, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_mark_shipped(uuid, text, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_record_proof(uuid, jsonb) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_set_item_photos(uuid, jsonb) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_create_sku_model(text, text, text, integer) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_archive_sku_model(uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_ensure_sku_variant(uuid, numeric) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_create_trade_offer(uuid, uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_accept_trade_offer(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_resolve_trade_offer(uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_trade_quote(uuid, uuid, uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_credit_balance(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_credit_available(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_credit_held(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_purchase_credit(text, integer, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_reserve_credit(uuid, bigint) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_release_credit_hold(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_payout_method_for_user(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_record_sweep(bigint, text, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_check_solvency(bigint) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_platform_position() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_set_country(text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_mark_default(uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_confirm_sale_cancellation(uuid, text, boolean) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_award_xp(uuid, integer, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_float_multiplier(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_tier_for_sku(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_tier_for_price(integer) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_grade_for_float(numeric) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_card_value_cents(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_config_bool(text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_config_num(text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_guard_sku_art_url(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_guard_sku_model_art_url(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_sync_condition_grade(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_refresh_float_percentiles() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_refresh_levels() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_block_sweep_mutation() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_mark_notification_read(uuid) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_vault_mark_shipped(uuid, text, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_vault_receive(uuid, text, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_vault_mark_defaulted(uuid, text) SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.fn_require_self_or_admin(uuid) SET search_path = 'public';

-- Fix trigger functions too
ALTER FUNCTION IF EXISTS public.trg_ledger_balanced() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.trg_ledger_card_balanced() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.trg_ledger_credit_balanced() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.trg_ledger_immutable() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.trg_sku_variant_derive() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.trg_users_id_matches_auth() SET search_path = 'public';
ALTER FUNCTION IF EXISTS public.trg_sku_model_propagate() SET search_path = 'public';

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