-- ============================================================================
-- 054_fair_market_cache.sql
--
-- Cached Fair Market Price per model: sku_models.fair_market_cents. The
-- number itself is DERIVED (median of the model's tape, trailing 90d —
-- see fairMarketPrice() in components/market/PriceChart.tsx, the one
-- definition), refreshed by the sync-comps cron through the service role
-- after every run, including models eBay skipped (manual pins still move
-- it within 24h). No admin write path reaches this column: the RLS
-- bench policies predate it, updateSkuModel() has no such field, and no
-- UI exposes it. Tier still comes from base_price_cents alone — this
-- column is display only and must never feed rarity.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER TABLE sku_models
  ADD COLUMN IF NOT EXISTS fair_market_cents integer
  CHECK (fair_market_cents IS NULL OR fair_market_cents > 0);

COMMENT ON COLUMN sku_models.fair_market_cents IS
  'Derived cache of the Fair Market Price (median of market_refs + settled sales, trailing 90d). Refreshed by the sync-comps cron (service role). Display only — never feeds tier.';

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
       AND column_name = 'fair_market_cents'
  ) THEN
    RAISE EXCEPTION '054: sku_models.fair_market_cents missing';
  END IF;

  RAISE NOTICE '054 ok: fair market cache column live';
END $$;
