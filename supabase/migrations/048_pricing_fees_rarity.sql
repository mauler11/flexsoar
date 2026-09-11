-- ============================================================================
-- 048_pricing_fees_rarity.sql
--
-- Three independent corrections, one migration to save round trips:
--
--   1. DEADSTOCK PIN. fn_float_multiplier's linear fallback
--      (1.0 - float * 0.48) discounted even Factory New stock ~2.3% under
--      oracle (float 0.048 -> 0.977x). A perfect shoe must hold full oracle:
--      floats inside the FN band (< 0.07, the band boundary in
--      lib/domain/rarity.ts) now pin to 1.0. The kink at the band edge is
--      how banded pricing works everywhere (tiers have cliffs too); real
--      per-SKU curve rows, when the oracle fills them, supersede this.
--
--   2. FLAT 8% FEE. Levels are display-only for now (no early access, no
--      fee ladder), so seller_fee_bps is 800 on every level. Reversible the
--      day the ladder returns — this UPDATE is the whole change, no logic
--      touched. fn_purchase_card_core keeps reading the table, so nothing
--      else moves.
--
--   3. LEGENDARY BRIGHTER. Tier 5's #E8B33A collides with the warn/amber
--      used by the first-sale banner and the above-fair indicator. Legendary
--      moves to vivid #FFD60A; warnings keep amber. rarity.ts mirrors this.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Deadstock pin in the fallback
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_float_multiplier(p_sku uuid, p_float numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT value_multiplier FROM sku_float_curve
      WHERE sku_id = p_sku AND p_float >= float_min AND p_float < float_max
      LIMIT 1),
    CASE WHEN p_float < 0.07 THEN 1.0 ELSE 1.0 - (p_float * 0.48) END
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Flat 8% fee on every level
-- ---------------------------------------------------------------------------

UPDATE levels SET seller_fee_bps = 800;

COMMENT ON TABLE levels IS
  'UNUSED except seller_fee_bps — levels system removed (032). All rows '
  'pinned to 800bps (048) so level is display-only until the ladder returns.';

-- ---------------------------------------------------------------------------
-- 3. Legendary brighter
-- ---------------------------------------------------------------------------

UPDATE tier_bands SET border_color = '#FFD60A' WHERE tier = 5;

-- ---------------------------------------------------------------------------
-- 4. Redeem CASE-into-enum fix
-- ---------------------------------------------------------------------------
-- fn_redeem_card assigns items.status from an all-literal CASE. Unknown
-- literals in a CASE resolve to TEXT (not coerced like a bare literal),
-- and text has no implicit cast to the item_status enum — every redeem
-- fails with 'column "status" is of type item_status but expression is of
-- type text'. Explicit casts fix the whole class; 008's sibling CASEs are
-- safe already (their ELSE branch is the bare column, which types the CASE).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_redeem_card(
  p_card_id uuid, p_user_id uuid, p_address jsonb, p_fee_cents integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_card cards%rowtype;
  v_item items%rowtype;
  v_txn  uuid := gen_random_uuid();
  v_red  uuid;
  v_days bigint;
BEGIN
  -- ADDED 026: p_user_id was taken on trust, so anyone could redeem anyone
  -- else's card to their own address.
  PERFORM fn_require_actor(p_user_id);

  SELECT * INTO v_card FROM cards WHERE id = p_card_id FOR UPDATE;
  IF v_card.owner_id <> p_user_id THEN RAISE EXCEPTION 'not your card'; END IF;
  IF v_card.status <> 'active' THEN
    RAISE EXCEPTION 'card % is %, expected active', p_card_id, v_card.status;
  END IF;

  SELECT * INTO v_item FROM items WHERE id = v_card.item_id FOR UPDATE;
  v_days := coalesce(fn_config_num('seller_shipment_days'), 7);

  UPDATE cards SET status = 'redeemed' WHERE id = p_card_id;

  UPDATE items SET status = CASE
    WHEN v_item.custody = 'seller' THEN 'awaiting_seller_shipment'::item_status
    ELSE 'redemption_hold'::item_status END
  WHERE id = v_item.id;

  INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction)
  VALUES (v_txn,'redemption_burn','card', p_user_id, p_card_id, -1);

  INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id, is_platform, amount_cents, direction) VALUES
    (v_txn,'handling_fee','currency', p_user_id, false, p_fee_cents, -1),
    (v_txn,'handling_fee','currency', null,      true,  p_fee_cents,  1);

  INSERT INTO redemptions (card_id, item_id, user_id, handling_fee_cents,
                           shipping_address, fulfiller_id, due_by, status)
  VALUES (p_card_id, v_card.item_id, p_user_id, p_fee_cents, p_address,
          CASE WHEN v_item.custody = 'seller' THEN v_item.custody_holder_id END,
          CASE WHEN v_item.custody = 'seller' THEN now() + make_interval(days => v_days::int) END,
          CASE WHEN v_item.custody = 'seller' THEN 'awaiting_seller' ELSE 'requested' END)
  RETURNING id INTO v_red;

  PERFORM fn_award_xp(p_user_id, 'redemption', 100, v_red);
  RETURN v_red;
END $$;

GRANT EXECUTE ON FUNCTION fn_redeem_card(uuid, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_redeem_card(uuid, uuid, jsonb, integer) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_src text;
  v_leak text;
  v_legend text;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_float_multiplier';

  IF v_src IS NULL OR v_src NOT LIKE '%WHEN p_float < 0.07 THEN 1.0%' THEN
    RAISE EXCEPTION '048: fn_float_multiplier lacks the deadstock pin';
  END IF;

  SELECT string_agg(level::text, ', ') INTO v_leak
  FROM levels WHERE seller_fee_bps IS DISTINCT FROM 800;
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION '048: levels not flat at 800bps: %', v_leak;
  END IF;

  SELECT border_color INTO v_legend FROM tier_bands WHERE tier = 5;
  IF v_legend IS DISTINCT FROM '#FFD60A' THEN
    RAISE EXCEPTION '048: legendary not #FFD60A, got %', v_legend;
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_redeem_card';
  IF v_src IS NULL OR v_src NOT LIKE '%::item_status%' THEN
    RAISE EXCEPTION '048: fn_redeem_card lacks the enum casts';
  END IF;

  RAISE NOTICE '048 ok: deadstock pin, flat 800bps, legendary #FFD60A, redeem casts';
END $$;
