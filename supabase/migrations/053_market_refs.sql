-- ============================================================================
-- 053_market_refs.sql
--
-- Trading tape backing (PriceChart): admin-entered market reference points
-- plus a public per-model sales aggregate. A definer FUNCTION serves the
-- sales series — not a view — because RLS on orders is still enforced
-- against the invoker through a view, and orders_own_read would filter a
-- public tape down to nothing. The function projects exactly three columns
-- (model_id, gross_cents, sold_at) for settled orders only: no
-- counterparty, no refs, capped at 200 rows per model.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS market_refs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id     uuid NOT NULL REFERENCES sku_models(id),
  price_cents  integer NOT NULL CHECK (price_cents > 0),
  source       text NOT NULL DEFAULT 'manual',
  observed_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_refs_model_observed_idx
  ON market_refs (model_id, observed_at);

ALTER TABLE market_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_refs_public_read ON market_refs;
CREATE POLICY market_refs_public_read ON market_refs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS market_refs_admin_write ON market_refs;
CREATE POLICY market_refs_admin_write ON market_refs
  FOR ALL USING (
    (select auth.jwt() ->> 'role') = 'service_role'
    OR public.fn_is_admin()
  );

CREATE OR REPLACE FUNCTION fn_sale_history_public(p_model_id uuid)
RETURNS TABLE (model_id uuid, gross_cents integer, sold_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.id, o.gross_cents, o.created_at
    FROM orders o
    JOIN cards c ON c.id = o.card_id
    JOIN skus s ON s.id = c.sku_id
    JOIN sku_models m ON m.id = s.model_id
   WHERE o.status = 'settled'
     AND m.id = p_model_id
   ORDER BY o.created_at
   LIMIT 200;
$$;

REVOKE EXECUTE ON FUNCTION fn_sale_history_public(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_sale_history_public(uuid) TO anon, authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_has_refs boolean;
  v_has_fn boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'market_refs_admin_write'
  ) INTO v_has_refs;
  IF NOT v_has_refs THEN
    RAISE EXCEPTION '053: market_refs_admin_write missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'fn_sale_history_public'
  ) INTO v_has_fn;
  IF NOT v_has_fn THEN
    RAISE EXCEPTION '053: fn_sale_history_public missing';
  END IF;

  IF NOT has_function_privilege('anon', 'public.fn_sale_history_public(uuid)', 'execute') THEN
    RAISE EXCEPTION '053: anon lacks execute on fn_sale_history_public';
  END IF;

  RAISE NOTICE '053 ok: market refs + public sale tape live';
END $$;
