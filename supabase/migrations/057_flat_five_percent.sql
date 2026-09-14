-- ============================================================================
-- 057_flat_five_percent.sql
--
-- Flat 5% platform fee on every level (800 -> 500bps). Sub-cent Solana
-- settlement makes 5% viable against card-rail competitors; the ledger
-- follows so on-chain splits and orders.fee_bps never disagree. Levels
-- stay display-only (032/048) — only the fee number moves. One-way door
-- for P&L going forward; historical orders keep the bps they settled at.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

UPDATE levels SET seller_fee_bps = 500;

COMMENT ON TABLE levels IS
  'UNUSED except seller_fee_bps — levels system removed (032). All rows '
  'pinned to 500bps (057; was 800bps under 048) so level is display-only '
  'until the ladder returns.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_leak text;
BEGIN
  SELECT string_agg(level::text, ', ') INTO v_leak
  FROM levels WHERE seller_fee_bps IS DISTINCT FROM 500;
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '057: levels not flat at 500bps';
  END IF;

  RAISE NOTICE '057 ok: flat 500bps fee live';
END $$;
