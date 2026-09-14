-- ============================================================================
-- 056_seller_wallets.sql
--
-- Seller payout destination for Solana settlement: users.solana_address.
-- Set ONLY through /api/solana/link-wallet, which demands an Ed25519
-- signature over a fresh caller-bound message (lib/solana/wallet.ts) —
-- the column is never written from client-supplied input directly. The
-- quote and settle paths read it as the sole seller destination: a
-- seller who never linked fails loudly at quote time, never mid-trade.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS solana_address text
  CHECK (solana_address IS NULL OR solana_address <> '');

COMMENT ON COLUMN users.solana_address IS
  'Seller USDC payout wallet (base58). Linked only via signed wallet-link message; read by the Solana quote/settle paths.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'solana_address'
  ) THEN
    RAISE EXCEPTION '056: users.solana_address missing';
  END IF;

  RAISE NOTICE '056 ok: seller wallet column live';
END $$;
