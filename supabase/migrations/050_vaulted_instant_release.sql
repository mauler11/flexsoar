-- ============================================================================
-- 050_vaulted_instant_release.sql
--
-- Vaulted sales skip the clearing hold. Rationale: payout_release_at exists
-- to cover the shipment window (shoe reaches us, we confirm, buyer can't be
-- left empty-handed). A warehouse-custody item is ALREADY here — there is no
-- shipment to wait for — so holding its payout 7 days buys nothing and reads
-- as the platform sitting on money.
--
-- Mechanism is a BEFORE INSERT trigger, not a fourth rewrite of the 300-line
-- fn_purchase_card_core: it sets NEW.payout_release_at = now() exactly when
-- the sold item sits in the warehouse and the seller is cash-method, and
-- touches nothing otherwise. Credit sellers are unaffected (in-ledger
-- instant already); seller-held items keep the full hold.
--
-- Risk accepted with eyes open: the hold ALSO absorbs payment risk
-- (disputes/chargebacks inside 7 days). Vaulted instant payout trades that
-- buffer for speed. Revisit if dispute rates ever justify it.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION trg_vaulted_instant_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_custody text;
BEGIN
  IF NEW.seller_payout IS DISTINCT FROM 'cash' THEN
    RETURN NEW;
  END IF;
  IF NEW.payout_release_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.custody INTO v_custody
  FROM cards c
  JOIN items i ON i.id = c.item_id
  WHERE c.id = NEW.card_id;

  IF v_custody = 'warehouse' THEN
    NEW.payout_release_at := now();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vaulted_instant_release ON orders;
CREATE TRIGGER vaulted_instant_release
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_vaulted_instant_release();

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vaulted_instant_release') THEN
    RAISE EXCEPTION '050: vaulted_instant_release trigger missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                 JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'
                   AND p.proname = 'trg_vaulted_instant_release'
                   AND p.prosecdef) THEN
    RAISE EXCEPTION '050: trg_vaulted_instant_release not definer';
  END IF;

  RAISE NOTICE '050 ok: vaulted sales release immediately';
END $$;
