-- ============================================================================
-- 041_fix_post_032_function_refs.sql
--
-- 032 dropped listings.early_access_level and listings.public_at, but two
-- live functions still reference them:
--
--   1. fn_approve_submission (030) INSERTs early_access_level/public_at
--      -> every admin approval fails with
--         'column "early_access_level" of relation "listings" does not exist'
--      Its notify block ALSO reads v_item.sku.brand, but items has no sku
--      column (only sku_id) — the next crash in line. Fixed here by
--      selecting the sku row explicitly.
--
--   2. fn_purchase_card_core (021) gates every buy on
--      v_l.public_at / v_l.early_access_level -> buys would fail the same
--      way. All listings are public since 032, so the gate is deleted; the
--      buyer-level select stays (provenance.owner_level still uses it).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. fn_approve_submission — fixed INSERT + real sku lookup for notify
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_approve_submission(
  p_item_id uuid, p_price_cents integer DEFAULT NULL, p_fair_price_cents integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin   uuid;
  v_item    items%rowtype;
  v_sku     skus%rowtype;
  v_card    uuid;
  v_price   integer;
  v_fair    integer;
  v_listing uuid;
BEGIN
  v_admin := fn_require_admin();

  SELECT * INTO v_item FROM items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item % not found', p_item_id; END IF;
  IF v_item.status <> 'pending_review' THEN
    RAISE EXCEPTION 'item % is %, expected pending_review', p_item_id, v_item.status;
  END IF;

  UPDATE items SET
    status           = 'in_custody',
    authenticated_by = v_admin,
    authenticated_at = now()
  WHERE id = p_item_id;

  v_card  := fn_mint_card(p_item_id, v_item.consignor_id);
  v_price := coalesce(p_price_cents, v_item.asking_price_cents);
  v_fair  := p_fair_price_cents;

  INSERT INTO listings (card_id, seller_id, price_cents, fair_price_cents, status,
                        oracle_value_cents, payout_method)
  VALUES (v_card, v_item.consignor_id, v_price, v_fair, 'public',
          fn_card_value_cents(v_card), v_item.submitted_payout)
  RETURNING id INTO v_listing;

  UPDATE cards SET status = 'locked' WHERE id = v_card;

  IF v_item.consignor_id IS NOT NULL THEN
    SELECT * INTO v_sku FROM skus WHERE id = v_item.sku_id;
    PERFORM fn_notify(
      v_item.consignor_id,
      'submission_approved',
      jsonb_build_object(
        'card_id', v_card,
        'listing_id', v_listing,
        'item_id', p_item_id,
        'brand', v_sku.brand,
        'model', v_sku.model,
        'colorway', v_sku.colorway,
        'size_us', v_sku.size_us,
        'price_cents', v_price,
        'fair_price_cents', v_fair
      )
    );
  END IF;

  RETURN v_card;
END $$;

GRANT EXECUTE ON FUNCTION fn_approve_submission(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_approve_submission(uuid, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. fn_purchase_card_core — drop the early-access gate (032 made all
--    listings public). Buyer-level select stays for provenance.owner_level.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_purchase_card_core(
  p_listing_id     uuid,
  p_buyer_id       uuid,
  p_settlement_ref text,
  p_credit_cents   bigint DEFAULT 0,
  p_hold_id        uuid   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_l           listings%rowtype;
  v_card        cards%rowtype;
  v_hold        credit_holds%rowtype;
  v_buyer_lvl   smallint;
  v_fee_bps     smallint;
  v_price       bigint;
  v_fee         bigint;
  v_net         bigint;
  v_credit      bigint;
  v_cash        bigint;
  v_balance     bigint;
  v_payout      payout_method;
  v_seller_cash boolean;
  v_pf_currency bigint;
  v_pf_credit   bigint;
  v_ref         text;
  v_hold_days   bigint;
  v_txn         uuid := gen_random_uuid();
  v_order       uuid;
BEGIN
  SELECT * INTO v_l FROM listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing % not found', p_listing_id;
  END IF;
  IF v_l.status NOT IN ('early_access','public') THEN
    RAISE EXCEPTION 'listing % is %', p_listing_id, v_l.status;
  END IF;
  IF v_l.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'cannot buy your own listing';
  END IF;

  SELECT * INTO v_card FROM cards WHERE id = v_l.card_id FOR UPDATE;

  -- All listings are public since 032: no early-access gate. The level is
  -- still read for card_provenance.owner_level below.
  SELECT level INTO v_buyer_lvl FROM users WHERE id = p_buyer_id;

  PERFORM 1 FROM users WHERE id = p_buyer_id FOR UPDATE;

  v_price  := v_l.price_cents;
  v_credit := least(greatest(coalesce(p_credit_cents, 0), 0), v_price);

  IF v_credit > 0 THEN
    IF coalesce(fn_config_bool('credit_payout_enabled'), false) IS NOT TRUE THEN
      RAISE EXCEPTION 'FSC settlement is disabled';
    END IF;

    IF p_hold_id IS NOT NULL THEN
      SELECT * INTO v_hold FROM credit_holds WHERE id = p_hold_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'credit hold % not found', p_hold_id;
      END IF;
      IF v_hold.status <> 'active' THEN
        RAISE EXCEPTION 'credit hold % is %', p_hold_id, v_hold.status;
      END IF;
      IF v_hold.expires_at <= now() THEN
        UPDATE credit_holds SET status = 'expired', released_at = now()
         WHERE id = p_hold_id;
        RAISE EXCEPTION 'credit hold % expired at %', p_hold_id, v_hold.expires_at;
      END IF;
      IF v_hold.user_id <> p_buyer_id THEN
        RAISE EXCEPTION 'credit hold % belongs to another user', p_hold_id;
      END IF;
      IF v_hold.listing_id <> p_listing_id THEN
        RAISE EXCEPTION 'credit hold % is for a different listing', p_hold_id;
      END IF;
      IF v_hold.amount_cents < v_credit THEN
        RAISE EXCEPTION 'credit hold % covers only % of % requested',
          p_hold_id, v_hold.amount_cents, v_credit;
      END IF;
    ELSIF fn_current_user_id() IS DISTINCT FROM p_buyer_id THEN
      RAISE EXCEPTION 'spending FSC requires a session matching the buyer, or a credit hold';
    END IF;

    v_balance := fn_credit_balance(p_buyer_id);
    IF v_balance < v_credit THEN
      RAISE EXCEPTION 'insufficient FSC: balance %, requested %', v_balance, v_credit;
    END IF;
  END IF;

  v_cash := v_price - v_credit;

  IF v_cash > 0 AND coalesce(btrim(p_settlement_ref), '') = '' THEN
    RAISE EXCEPTION 'a cash leg of % cents requires a settlement_ref', v_cash;
  END IF;

  v_ref := coalesce(nullif(btrim(p_settlement_ref), ''), 'fsc:' || v_txn::text);

  v_payout      := fn_payout_method_for_user(v_l.seller_id);
  v_seller_cash := (v_payout = 'cash');

  SELECT l.seller_fee_bps INTO v_fee_bps
  FROM users u JOIN levels l ON l.level = u.level
  WHERE u.id = v_l.seller_id;

  v_fee := floor(v_price * coalesce(v_fee_bps, 0) / 10000.0);
  v_net := v_price - v_fee;

  v_pf_currency := v_cash   - (CASE WHEN v_seller_cash THEN v_net ELSE 0 END);
  v_pf_credit   := v_credit - (CASE WHEN v_seller_cash THEN 0 ELSE v_net END);

  v_hold_days := coalesce(fn_config_num('payout_hold_days'), 7);

  INSERT INTO orders (listing_id, card_id, buyer_id, seller_id, gross_cents,
                      fee_bps, fee_cents, net_cents, settlement_ref, status, txn_id,
                      credit_cents, cash_cents, seller_payout, payout_release_at)
  VALUES (p_listing_id, v_l.card_id, p_buyer_id, v_l.seller_id, v_price,
          v_fee_bps, v_fee, v_net, v_ref, 'settled', v_txn,
          v_credit, v_cash, v_payout,
          CASE WHEN v_seller_cash
               THEN now() + make_interval(days => v_hold_days::int)
          END)
  RETURNING id INTO v_order;

  IF p_hold_id IS NOT NULL THEN
    UPDATE credit_holds
       SET status = 'consumed', consumed_at = now(), order_id = v_order
     WHERE id = p_hold_id;
  END IF;

  IF v_cash > 0 THEN
    INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction, settlement_ref)
    VALUES (v_txn,'sale_gross','currency', p_buyer_id, false, v_cash, -1, v_ref);
  END IF;

  IF v_seller_cash THEN
    INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction, settlement_ref)
    VALUES (v_txn,'sale_net','currency', v_l.seller_id, false, v_net, 1, v_ref);
  END IF;

  IF v_pf_currency <> 0 THEN
    INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction, settlement_ref)
    VALUES (v_txn,'sale_fee','currency', null, true,
            abs(v_pf_currency), sign(v_pf_currency)::smallint, v_ref);
  END IF;

  IF v_credit > 0 THEN
    INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    VALUES (v_txn,'credit_sale_gross','credit', p_buyer_id, false, v_credit, -1);
  END IF;

  IF NOT v_seller_cash THEN
    INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    VALUES (v_txn,'credit_sale_net','credit', v_l.seller_id, false, v_net, 1);
  END IF;

  IF v_pf_credit <> 0 THEN
    INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    VALUES (v_txn,'credit_sale_fee','credit', null, true,
            abs(v_pf_credit), sign(v_pf_credit)::smallint);
  END IF;

  INSERT INTO ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction)
  VALUES (v_txn,'card_transfer','card', v_l.seller_id, v_l.card_id, -1),
         (v_txn,'card_transfer','card', p_buyer_id,    v_l.card_id,  1);

  UPDATE cards SET owner_id = p_buyer_id, status = 'active' WHERE id = v_l.card_id;

  UPDATE card_provenance
     SET released_at = now(), price_cents = v_price
   WHERE card_id = v_l.card_id AND owner_id = v_l.seller_id AND released_at IS NULL;

  INSERT INTO card_provenance (card_id, owner_id, owner_level, acquired_at, price_cents)
  VALUES (v_l.card_id, p_buyer_id, coalesce(v_buyer_lvl,1), now(), v_price);

  UPDATE listings SET status = 'sold', sold_at = now() WHERE id = p_listing_id;

  PERFORM fn_award_xp(p_buyer_id,    'purchase', greatest(10, (v_price / 1000)::int), v_order);
  PERFORM fn_award_xp(v_l.seller_id, 'sale',     greatest(10, (v_price / 1000)::int), v_order);

  RETURN v_order;
END
$function$;

-- Grants unchanged (service_role-only core per 022b); CREATE OR REPLACE
-- preserves them, restated here defensively.
REVOKE EXECUTE ON FUNCTION fn_purchase_card_core(uuid, uuid, text, bigint, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_purchase_card_core(uuid, uuid, text, bigint, uuid) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions: neither function may reference the dropped columns anymore
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_bad text;
  v_sig text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('fn_approve_submission', 'fn_purchase_card_core')
    AND (p.prosrc LIKE '%early_access_level%' OR p.prosrc LIKE '%public_at%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '041: still referencing dropped columns: %', v_bad;
  END IF;

  SELECT pg_get_function_identity_arguments(oid) INTO v_sig
  FROM pg_proc
  WHERE proname = 'fn_approve_submission'
    AND pronamespace = 'public'::regnamespace;
  IF v_sig NOT LIKE '%fair_price_cents%' THEN
    RAISE EXCEPTION '041: fn_approve_submission lost fair_price_cents. Got: %', v_sig;
  END IF;

  RAISE NOTICE '041 ok: approve + purchase_core free of early_access refs';
END $$;
