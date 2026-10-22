-- 081b container test, part 1 of 3: synthesise the production test item EXACTLY as the 2026-10-22 inventory showed it
-- (prod-runbook-081/inventory-081-test-item.sql), plus unrelated "noise" rows that 081b must leave byte-identical. COMMITS
-- to the disposable database. psql only, never npm.
--   psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -v variant=<v> -f 85_retire_test_item_setup.sql
-- variant=main             the production shape; 081b must apply.
-- variant=intake_shipped   the intake carries shipped_at;              081b must refuse.
-- variant=order_paid       the order has paid_out=true;                081b must refuse.
-- variant=live_listing     a second, public listing for the card;      081b must refuse.
-- variant=card_active      the card is active, not pending_vault;      081b must refuse.
-- variant=redemption       a redemption references the item;           081b must refuse.
-- variant=not_reviewed     review_approved_at is NULL;                 081b must refuse.
-- variant=absent           none of the five named rows exist (noise only); 081b must commit a no-op.
-- variant=partial          only the named item exists;                 081b must refuse.
\ir 00_target_guard.sql
\if :{?variant}
\else
\set variant main
\endif
\set QUIET 1
BEGIN;
CREATE SCHEMA t081b;
CREATE TABLE t081b.meta(k text PRIMARY KEY, v text NOT NULL);
INSERT INTO t081b.meta VALUES ('variant', :'variant');
DO $fx$
DECLARE v text := (SELECT m.v FROM t081b.meta m WHERE m.k = 'variant');
 consignor uuid := gen_random_uuid(); buyer uuid := gen_random_uuid(); admin2 uuid := gen_random_uuid();
 model uuid := gen_random_uuid(); sku uuid := gen_random_uuid();
 item uuid := '89887db1-dba3-46ec-994c-3125d8513b70'; card uuid := '0d90f5e4-b4dc-4783-8b07-c6412df3fd16';
 listing uuid := 'f39fbe1f-979e-4237-a9f9-ed9f9dcc67e6'; ord uuid := '478ef5b4-2cc4-431c-8754-c0f33d3f0e75';
 intake uuid := '4b59ace6-1af4-48aa-9370-b73662a2850e';
 n_item uuid := gen_random_uuid(); n_card uuid := gen_random_uuid(); n_listing uuid := gen_random_uuid(); n_order uuid := gen_random_uuid();
 sold_at timestamptz := '2026-09-25 18:18:46.966277+00'; mint_txn uuid := gen_random_uuid(); sale_txn uuid := gen_random_uuid();
BEGIN
 INSERT INTO public.users(id, auth_id, handle, email, country_code, is_admin) VALUES
  (consignor, consignor, 't81c' || left(replace(consignor::text,'-',''),16), 't81-' || consignor || '@example.invalid', 'MY', false),
  (buyer, buyer, 't81b' || left(replace(buyer::text,'-',''),16), 't81-' || buyer || '@example.invalid', 'MY', true),
  (admin2, admin2, 't81a' || left(replace(admin2::text,'-',''),16), 't81-' || admin2 || '@example.invalid', 'MY', true);
 INSERT INTO public.sku_models(id, brand, model, colorway, base_price_cents) VALUES (model, 'Synthetic081b', 'M-' || model, 'Test', 2000);
 INSERT INTO public.skus(id, model_id, brand, model, colorway, size_us) VALUES (sku, model, 'Synthetic081b', 'Derived', 'Test', 10);
 IF v <> 'absent' THEN
 -- The test item after 080: seller-held, minted, seller_declared, review stamp moved to review_approved_*.
 INSERT INTO public.items(id, sku_id, consignor_id, status, float_value, graded_by, graded_at, custody, custody_holder_id, grade_source,
   asking_price_cents, review_approved_at, review_approved_by)
 VALUES (item, sku, consignor, 'minted', 0.120, consignor, '2026-09-25 06:50:00+00', 'seller', consignor, 'seller_declared', 2000,
   CASE WHEN v = 'not_reviewed' THEN NULL ELSE '2026-09-25 06:56:12.503478+00'::timestamptz END, CASE WHEN v = 'not_reviewed' THEN NULL ELSE admin2 END);
 END IF;
 IF v NOT IN ('absent', 'partial') THEN
 INSERT INTO public.cards(id, item_id, sku_id, owner_id, float_value, tier, mint_number, status)
 VALUES (card, item, sku, buyer, 0.120, 1, 1, CASE WHEN v = 'card_active' THEN 'active' ELSE 'pending_vault' END::public.card_status);
 INSERT INTO public.listings(id, card_id, seller_id, price_cents, status, payout_method) VALUES (listing, card, consignor, 2000, 'sold', 'cash');
 IF v = 'live_listing' THEN
  INSERT INTO public.listings(id, card_id, seller_id, price_cents, status, payout_method) VALUES (gen_random_uuid(), card, buyer, 2500, 'public', 'cash');
 END IF;
 INSERT INTO public.orders(id, listing_id, card_id, buyer_id, seller_id, gross_cents, fee_bps, fee_cents, net_cents, settlement_ref, status, seller_payout, paid_out, created_at)
 VALUES (ord, listing, card, buyer, consignor, 2000, 500, 100, 1900, 'sol:synthetic-081b-devnet', 'settled', 'cash', v = 'order_paid', sold_at);
 -- Ledger: mint to the consignor; the sale moves the card and nets three currency legs to zero.
 INSERT INTO public.ledger_entries(txn_id, entry_type, asset, account_id, card_id, direction) VALUES (mint_txn, 'mint', 'card', consignor, card, 1);
 INSERT INTO public.ledger_entries(txn_id, entry_type, asset, account_id, card_id, direction) VALUES
  (sale_txn, 'card_transfer', 'card', consignor, card, -1), (sale_txn, 'card_transfer', 'card', buyer, card, 1);
 INSERT INTO public.ledger_entries(txn_id, entry_type, asset, account_id, is_platform, amount_cents, direction) VALUES
  (sale_txn, 'sale_gross', 'currency', buyer, false, 2000, -1), (sale_txn, 'sale_net', 'currency', consignor, false, 1900, 1),
  (sale_txn, 'sale_fee', 'currency', NULL, true, 100, 1);
 INSERT INTO public.card_provenance(card_id, owner_id, owner_level, acquired_at, released_at, price_cents) VALUES
  (card, consignor, 1, '2026-09-25 06:56:12.503478+00', sold_at, NULL), (card, buyer, 1, sold_at, NULL, 2000);
 INSERT INTO public.notifications(user_id, type, payload) VALUES (consignor, 'submission_approved', jsonb_build_object('item_id', item, 'card_id', card));
 INSERT INTO public.vault_intakes(id, order_id, item_id, card_id, consignor_id, buyer_id, status, due_by, shipped_at, created_at)
 VALUES (intake, ord, item, card, consignor, buyer, 'awaiting_shipment', sold_at + interval '48 hours',
   CASE WHEN v = 'intake_shipped' THEN sold_at + interval '1 day' END, sold_at);
 IF v = 'redemption' THEN
  INSERT INTO public.redemptions(card_id, item_id, user_id, handling_fee_cents, shipping_address, status) VALUES (card, item, buyer, 0, '{}'::jsonb, 'requested');
 END IF;
 END IF;
 -- Noise: an unrelated sold card with its own open intake; 081b must not touch any of it.
 INSERT INTO public.items(id, sku_id, consignor_id, status, float_value, custody, custody_holder_id, grade_source, asking_price_cents)
 VALUES (n_item, sku, consignor, 'minted', 0.200, 'seller', consignor, 'seller_declared', 3000);
 INSERT INTO public.cards(id, item_id, sku_id, owner_id, float_value, tier, mint_number, status) VALUES (n_card, n_item, sku, buyer, 0.200, 1, 2, 'pending_vault');
 INSERT INTO public.listings(id, card_id, seller_id, price_cents, status, payout_method) VALUES (n_listing, n_card, consignor, 3000, 'sold', 'cash');
 INSERT INTO public.orders(id, listing_id, card_id, buyer_id, seller_id, gross_cents, fee_bps, fee_cents, net_cents, settlement_ref, status, seller_payout)
 VALUES (n_order, n_listing, n_card, buyer, consignor, 3000, 500, 150, 2850, 'sol:synthetic-081b-noise', 'settled', 'cash');
 INSERT INTO public.vault_intakes(order_id, item_id, card_id, consignor_id, buyer_id, status, due_by) VALUES (n_order, n_item, n_card, consignor, buyer, 'awaiting_shipment', now());
END $fx$;
-- Full snapshots for 86/87.
CREATE TABLE t081b.snap AS
 SELECT 'cards' AS t, to_jsonb(x) AS row FROM public.cards x
 UNION ALL SELECT 'vault_intakes', to_jsonb(x) FROM public.vault_intakes x
 UNION ALL SELECT 'listings', to_jsonb(x) FROM public.listings x
 UNION ALL SELECT 'orders', to_jsonb(x) FROM public.orders x
 UNION ALL SELECT 'items', to_jsonb(x) FROM public.items x
 UNION ALL SELECT 'ledger_entries', to_jsonb(x) FROM public.ledger_entries x
 UNION ALL SELECT 'card_provenance', to_jsonb(x) FROM public.card_provenance x
 UNION ALL SELECT 'notifications', to_jsonb(x) FROM public.notifications x
 UNION ALL SELECT 'redemptions', to_jsonb(x) FROM public.redemptions x;
COMMIT;
\unset QUIET
SELECT 'SETUP|variant=' || v FROM t081b.meta WHERE k = 'variant';
\echo T085_SETUP_OK
