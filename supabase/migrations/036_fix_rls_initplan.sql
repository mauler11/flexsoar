-- ============================================================================
-- 036_fix_rls_initplan.sql
-- Wrap auth.* calls in (select ...) to avoid per-row re-evaluation
-- RUN IN: Supabase SQL Editor, "Run without RLS"
-- ============================================================================

BEGIN;

-- ============================================================================
-- items table policies
-- ============================================================================

-- items_admin_read
DROP POLICY IF EXISTS items_admin_read ON public.items;
CREATE POLICY items_admin_read ON public.items
  FOR SELECT USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

-- items_consignor_read
DROP POLICY IF EXISTS items_consignor_read ON public.items;
CREATE POLICY items_consignor_read ON public.items
  FOR SELECT USING (
    (select auth.uid()) = consignor_id
  );

-- items_holder_read (column is custody_holder_id, not holder_id)
DROP POLICY IF EXISTS items_holder_read ON public.items;
CREATE POLICY items_holder_read ON public.items
  FOR SELECT USING (
    (select auth.uid()) = custody_holder_id
  );

-- items_public_read (use valid item_status enum values)
DROP POLICY IF EXISTS items_public_read ON public.items;
CREATE POLICY items_public_read ON public.items
  FOR SELECT USING (
    status IN ('minted', 'redemption_hold', 'shipped', 'released')
  );

-- ============================================================================
-- users table policies
-- ============================================================================

-- users_self_read
DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT USING (
    (select auth.uid()) = id
  );

-- users_self_insert
DROP POLICY IF EXISTS users_self_insert ON public.users;
CREATE POLICY users_self_insert ON public.users
  FOR INSERT WITH CHECK (
    (select auth.uid()) = id
  );

-- users_self_update
DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users
  FOR UPDATE USING (
    (select auth.uid()) = id
  );

-- users_admin_read (keep, but optimize - use fn_is_admin() to avoid recursion)
DROP POLICY IF EXISTS users_admin_read ON public.users;
CREATE POLICY users_admin_read ON public.users
  FOR SELECT USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

-- ============================================================================
-- Other tables with multiple permissive policies (consolidate where possible)
-- ============================================================================

-- consignments: merge admin_read + own_read
DROP POLICY IF EXISTS consignments_admin_read ON public.consignments;
DROP POLICY IF EXISTS consignments_own_read ON public.consignments;
CREATE POLICY consignments_read ON public.consignments
  FOR SELECT USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
    OR (select auth.uid()) = consignor_id
  );

-- redemptions: merge admin_read + own_read
DROP POLICY IF EXISTS redemptions_admin_read ON public.redemptions;
DROP POLICY IF EXISTS redemptions_own_read ON public.redemptions;
CREATE POLICY redemptions_read ON public.redemptions
  FOR SELECT USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
    OR (select auth.uid()) = user_id
  );

-- platform_config: merge admin_write + read
DROP POLICY IF EXISTS config_admin_write ON public.platform_config;
DROP POLICY IF EXISTS config_read ON public.platform_config;
CREATE POLICY config_read ON public.platform_config
  FOR SELECT USING (true);
CREATE POLICY config_admin_write ON public.platform_config
  FOR ALL USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

-- skus: merge admin_write + read
DROP POLICY IF EXISTS skus_admin_write ON public.skus;
DROP POLICY IF EXISTS skus_read ON public.skus;
CREATE POLICY skus_read ON public.skus
  FOR SELECT USING (true);
CREATE POLICY skus_admin_write ON public.skus
  FOR ALL USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

-- sku_models: merge admin_write + read
DROP POLICY IF EXISTS sku_models_admin_write ON public.sku_models;
DROP POLICY IF EXISTS sku_models_read ON public.sku_models;
CREATE POLICY sku_models_read ON public.sku_models
  FOR SELECT USING (true);
CREATE POLICY sku_models_admin_write ON public.sku_models
  FOR ALL USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

-- condition_bands: merge admin_write + read
DROP POLICY IF EXISTS condition_bands_admin_write ON public.condition_bands;
DROP POLICY IF EXISTS condition_bands_read ON public.condition_bands;
CREATE POLICY condition_bands_read ON public.condition_bands
  FOR SELECT USING (true);
CREATE POLICY condition_bands_admin_write ON public.condition_bands
  FOR ALL USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

-- sku_float_curve: merge admin_write + read
DROP POLICY IF EXISTS curve_admin_write ON public.sku_float_curve;
DROP POLICY IF EXISTS curve_read ON public.sku_float_curve;
CREATE POLICY curve_read ON public.sku_float_curve
  FOR SELECT USING (true);
CREATE POLICY curve_admin_write ON public.sku_float_curve
  FOR ALL USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

-- cash_payout_countries: merge admin_write + read
DROP POLICY IF EXISTS cash_payout_countries_admin_write ON public.cash_payout_countries;
DROP POLICY IF EXISTS cash_payout_countries_read ON public.cash_payout_countries;
CREATE POLICY cash_payout_countries_read ON public.cash_payout_countries
  FOR SELECT USING (true);
CREATE POLICY cash_payout_countries_admin_write ON public.cash_payout_countries
  FOR ALL USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

COMMIT;

-- Verify
DO $$
DECLARE
  v_pol text;
BEGIN
  FOR v_pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public'
    AND (qual NOT ILIKE '%(select auth.%'
         OR with_check NOT ILIKE '%(select auth.%')
  LOOP
    RAISE NOTICE 'Policy % may still have unwrapped auth call', v_pol;
  END LOOP;
END $$;