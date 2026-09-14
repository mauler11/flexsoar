-- ============================================================================
-- 055_model_retail.sql
--
-- Official retail price per model (sku_models.retail_price_cents): the
-- brand's box price (Nike/Adidas list), entered once by an admin and then
-- frozen — retail never follows the secondary market, which is exactly
-- what makes it the chart's fixed coordinate. Display only: tier still
-- comes from base_price_cents alone, and the Fair Market Price falls back
-- to this value only while a model has no tape yet (bootstrap stage 2).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER TABLE sku_models
  ADD COLUMN IF NOT EXISTS retail_price_cents integer
  CHECK (retail_price_cents IS NULL OR retail_price_cents > 0);

COMMENT ON COLUMN sku_models.retail_price_cents IS
  'Official brand retail price (box price), admin-entered once. Static reference for the tape and the Fair Market Price bootstrap fallback. Display only — never feeds tier.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sku_models'
       AND column_name = 'retail_price_cents'
  ) THEN
    RAISE EXCEPTION '055: sku_models.retail_price_cents missing';
  END IF;

  RAISE NOTICE '055 ok: model retail column live';
END $$;
