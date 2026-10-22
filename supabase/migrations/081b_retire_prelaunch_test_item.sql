-- ============================================================================
-- 081b_retire_prelaunch_test_item.sql
--
-- Founder decision 2026-10-22: retire the pre-launch test item. It was a test
-- sale on devnet; the buyer is the founder's own admin test account; no funds
-- moved. Requires 080 and 081 applied. One transaction; a guard failure rolls
-- the whole file back.
--
-- One-off: names the rows by id (founder-approved for this retirement only)
-- AND asserts every expected value read by the production inventory
-- (prod-runbook-081/inventory-081-test-item.sql, run 2026-10-22). Any
-- difference aborts.
--
-- Writes exactly two rows:
--   1. card 0d90f5e4-...: pending_vault -> burned. This is the end state of
--      the existing retirement path fn_burn_card (028:131-165), which cannot
--      be used here: it needs an admin session and refuses pending_vault
--      cards. Like fn_burn_card it would cancel live listings; the preguard
--      requires there are none (the only listing is 'sold'), so that update
--      must touch 0 rows.
--   2. vault intake 4b59ace6-...: awaiting_shipment -> cancelled, with a note.
--      'cancelled' is an allowed status (023c vault_intakes_status_check).
-- The order, its listing, the item, the ledger and the provenance are kept
-- untouched as history. No money moves: the order's cash payout stays
-- unpaid, and no code path can pay it (checkPayoutEligibility marks a 'sol:'
-- order ineligible, executePayout always throws, no SQL sets paid_out).
--
-- Presence: all five named rows (item, card, listing, order, intake) must
-- exist, as on production; or none of them (a database that never had the test
-- sale, e.g. staging): then nothing is retired, a NOTICE says so, and the
-- "everything else unchanged" postguard still runs. Any other count aborts.
--
-- Postguards: exactly those two rows changed (each only in the named
-- columns); every other row of cards, vault_intakes, listings, orders, items,
-- ledger_entries, card_provenance and notifications is byte-identical; the
-- card is visible neither on /market (no 'public'/'early_access' listing) nor
-- on profile/card lists (status not active/locked/pending_vault).
-- ============================================================================

BEGIN;

LOCK TABLE public.cards, public.vault_intakes, public.listings, public.orders, public.items IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE m081b_ids ON COMMIT DROP AS SELECT
 '89887db1-dba3-46ec-994c-3125d8513b70'::uuid AS item_id,
 '0d90f5e4-b4dc-4783-8b07-c6412df3fd16'::uuid AS card_id,
 'f39fbe1f-979e-4237-a9f9-ed9f9dcc67e6'::uuid AS listing_id,
 '478ef5b4-2cc4-431c-8754-c0f33d3f0e75'::uuid AS order_id,
 '4b59ace6-1af4-48aa-9370-b73662a2850e'::uuid AS intake_id,
 $n$081b (founder decision 2026-10-22): pre-launch test sale on devnet; buyer was the founder's own test account; no funds moved. Intake cancelled and card retired; order, ledger and provenance kept as history.$n$::text AS note;

-- How many of the five named rows exist: 5 = production (retire), 0 = a database that never had the test sale (staging,
-- a fresh replay: no-op with a NOTICE; the "everything else unchanged" postguard still runs), anything else aborts.
CREATE TEMP TABLE m081b_present ON COMMIT DROP AS SELECT
 (SELECT count(*) FROM public.items i, m081b_ids k WHERE i.id=k.item_id)
 + (SELECT count(*) FROM public.cards c, m081b_ids k WHERE c.id=k.card_id)
 + (SELECT count(*) FROM public.listings l, m081b_ids k WHERE l.id=k.listing_id)
 + (SELECT count(*) FROM public.orders o, m081b_ids k WHERE o.id=k.order_id)
 + (SELECT count(*) FROM public.vault_intakes v, m081b_ids k WHERE v.id=k.intake_id) AS n;

-- Snapshots: the two target rows, and a hash of everything else that must not move.
CREATE TEMP TABLE m081b_before ON COMMIT DROP AS SELECT
 (SELECT to_jsonb(c) FROM public.cards c, m081b_ids k WHERE c.id=k.card_id) AS card_row,
 (SELECT to_jsonb(v) FROM public.vault_intakes v, m081b_ids k WHERE v.id=k.intake_id) AS intake_row;
CREATE TEMP TABLE m081b_others ON COMMIT DROP AS
 SELECT t.name, t.n, t.h FROM (
  SELECT 'cards' AS name, count(*) AS n, md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) AS h FROM public.cards x WHERE x.id<>(SELECT card_id FROM m081b_ids)
  UNION ALL SELECT 'vault_intakes', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.vault_intakes x WHERE x.id<>(SELECT intake_id FROM m081b_ids)
  UNION ALL SELECT 'listings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.listings x
  UNION ALL SELECT 'orders', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.orders x
  UNION ALL SELECT 'items', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.items x
  UNION ALL SELECT 'ledger_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.ledger_entries x
  UNION ALL SELECT 'card_provenance', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY to_jsonb(x)::text),'')) FROM public.card_provenance x
  UNION ALL SELECT 'notifications', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.notifications x
 ) t;

DO $preguard$
DECLARE k m081b_ids%rowtype; v_n bigint;
BEGIN
 SELECT * INTO k FROM m081b_ids;
 -- 080 and 081 applied.
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.fn_confirm_shipment(uuid,text,text)'::regprocedure)<>'4f1b8f8396b0656d275a545c55447d50' THEN
  RAISE EXCEPTION '081b: 080 is not applied';
 END IF;
 IF has_function_privilege('anon','public.fn_set_card_visibility(uuid,boolean)','EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.fn_set_card_visibility(uuid,boolean)'::regprocedure AND a.grantee=0::oid) THEN
  RAISE EXCEPTION '081b: 081 is not applied';
 END IF;
 IF (SELECT n FROM m081b_present)=0 THEN
  RAISE NOTICE '081b: the test item, card, listing, order and intake are all absent; nothing to retire';
  RETURN;
 END IF;
 IF (SELECT n FROM m081b_present)<>5 THEN
  RAISE EXCEPTION '081b: only % of the 5 named rows exist; refusing a partial retirement',(SELECT n FROM m081b_present);
 END IF;
 -- Item (inventory I1): the five founder-approved values, plus the rest of I1.
 IF NOT EXISTS(SELECT 1 FROM public.items i WHERE i.id=k.item_id AND i.custody='seller' AND i.status='minted' AND i.grade_source='seller_declared'
   AND i.authenticated_at IS NULL AND i.authenticated_by IS NULL AND i.review_approved_at IS NOT NULL AND i.consignment_id IS NULL) THEN
  RAISE EXCEPTION '081b: item % is not in the expected state (seller, minted, seller_declared, not authenticated, review-approved)',k.item_id;
 END IF;
 -- Card (I2): the only card of the item, pending_vault, owned by someone other than the consignor.
 IF (SELECT count(*) FROM public.cards WHERE item_id=k.item_id)<>1
  OR NOT EXISTS(SELECT 1 FROM public.cards c JOIN public.items i ON i.id=c.item_id WHERE c.id=k.card_id AND c.item_id=k.item_id
   AND c.status='pending_vault' AND c.owner_id<>i.consignor_id) THEN
  RAISE EXCEPTION '081b: card % is not the item''s only card in pending_vault owned by the buyer',k.card_id;
 END IF;
 -- Listing (I3): exactly one, sold, by the consignor; no live listing.
 IF (SELECT count(*) FROM public.listings WHERE card_id=k.card_id)<>1
  OR NOT EXISTS(SELECT 1 FROM public.listings l JOIN public.items i ON i.id=k.item_id WHERE l.id=k.listing_id AND l.card_id=k.card_id AND l.status='sold' AND l.seller_id=i.consignor_id) THEN
  RAISE EXCEPTION '081b: listing state differs from the inventory (expected exactly one, sold)';
 END IF;
 -- Order (I4): exactly one, settled, unpaid, a 'sol:' reference, buyer is an admin and not the seller, seller not an admin.
 IF (SELECT count(*) FROM public.orders WHERE card_id=k.card_id)<>1
  OR NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.id=k.order_id AND o.card_id=k.card_id AND o.listing_id=k.listing_id AND o.status='settled'
   AND NOT o.paid_out AND o.stripe_transfer_id IS NULL AND o.settlement_ref LIKE 'sol:%' AND o.buyer_id<>o.seller_id
   AND (SELECT u.is_admin FROM public.users u WHERE u.id=o.buyer_id) AND NOT (SELECT u.is_admin FROM public.users u WHERE u.id=o.seller_id)
   AND o.buyer_id=(SELECT owner_id FROM public.cards WHERE id=k.card_id)) THEN
  RAISE EXCEPTION '081b: order state differs from the inventory (expected settled, unpaid, sol:, admin buyer owning the card)';
 END IF;
 -- Vault intake (I6): the only intake of the item, awaiting_shipment, never shipped/received/defaulted, bound to this order.
 IF (SELECT count(*) FROM public.vault_intakes WHERE item_id=k.item_id)<>1
  OR NOT EXISTS(SELECT 1 FROM public.vault_intakes v WHERE v.id=k.intake_id AND v.item_id=k.item_id AND v.card_id=k.card_id AND v.order_id=k.order_id
   AND v.status='awaiting_shipment' AND v.shipped_at IS NULL AND v.received_at IS NULL AND v.defaulted_at IS NULL) THEN
  RAISE EXCEPTION '081b: vault intake state differs from the inventory (expected awaiting_shipment, never shipped/received/defaulted)';
 END IF;
 -- I7: nothing else may reference the card or item.
 SELECT (SELECT count(*) FROM public.redemptions WHERE item_id=k.item_id OR card_id=k.card_id)
  + (SELECT count(*) FROM public.trade_offers WHERE k.card_id IN (offered_card_id, requested_card_id))
  + (SELECT count(*) FROM public.credit_holds WHERE listing_id=k.listing_id)
  + (SELECT count(*) FROM payment_v2.inventory WHERE item_id=k.item_id OR card_id=k.card_id)
  + (SELECT count(*) FROM payment_v2.sales WHERE item_id=k.item_id OR card_id=k.card_id) INTO v_n;
 IF v_n<>0 THEN RAISE EXCEPTION '081b: % redemption/trade/credit-hold/payment-v2 row(s) reference the test item; review before retiring',v_n;END IF;
END $preguard$;

DO $retire$
DECLARE k m081b_ids%rowtype; v_n bigint;
BEGIN
 SELECT * INTO k FROM m081b_ids;
 IF (SELECT n FROM m081b_present)=0 THEN RETURN; END IF;
 -- fn_burn_card's listing step; the preguard proved there is nothing to cancel.
 UPDATE public.listings SET status='cancelled' WHERE card_id=k.card_id AND status IN ('early_access','public');
 GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n<>0 THEN RAISE EXCEPTION '081b: cancelled % live listing(s), expected 0',v_n;END IF;
 UPDATE public.cards SET status='burned' WHERE id=k.card_id AND status='pending_vault';
 GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n<>1 THEN RAISE EXCEPTION '081b: retired % card(s), expected 1',v_n;END IF;
 UPDATE public.vault_intakes SET status='cancelled', note=concat_ws(E'\n', nullif(note,''), k.note) WHERE id=k.intake_id AND status='awaiting_shipment';
 GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n<>1 THEN RAISE EXCEPTION '081b: cancelled % vault intake(s), expected 1',v_n;END IF;
 RAISE NOTICE '081b: card retired (burned) and vault intake cancelled; order, ledger and provenance untouched';
END $retire$;

DO $postguard$
DECLARE k m081b_ids%rowtype; b m081b_before%rowtype; r record;
BEGIN
 SELECT * INTO k FROM m081b_ids; SELECT * INTO b FROM m081b_before;
 -- The card changed in status only (when the test item exists).
 IF (SELECT n FROM m081b_present)=5 AND NOT EXISTS(SELECT 1 FROM public.cards c WHERE c.id=k.card_id AND c.status='burned'
   AND (to_jsonb(c)-'status') = (b.card_row-'status')) THEN
  RAISE EXCEPTION '081b: the card changed beyond its status';
 END IF;
 -- The intake changed in status and note only; the note carries the decision.
 IF (SELECT n FROM m081b_present)=5 AND NOT EXISTS(SELECT 1 FROM public.vault_intakes v WHERE v.id=k.intake_id AND v.status='cancelled' AND v.note LIKE '%'||k.note
   AND (to_jsonb(v)-'status'-'note') = (b.intake_row-'status'-'note')) THEN
  RAISE EXCEPTION '081b: the vault intake changed beyond its status and note';
 END IF;
 -- Everything else is byte-identical.
 FOR r IN SELECT o.name, o.n, o.h, cur.n AS n2, cur.h AS h2 FROM m081b_others o JOIN (
   SELECT 'cards' AS name, count(*) AS n, md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) AS h FROM public.cards x WHERE x.id<>k.card_id
   UNION ALL SELECT 'vault_intakes', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.vault_intakes x WHERE x.id<>k.intake_id
   UNION ALL SELECT 'listings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.listings x
   UNION ALL SELECT 'orders', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.orders x
   UNION ALL SELECT 'items', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.items x
   UNION ALL SELECT 'ledger_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.ledger_entries x
   UNION ALL SELECT 'card_provenance', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY to_jsonb(x)::text),'')) FROM public.card_provenance x
   UNION ALL SELECT 'notifications', count(*), md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id),'')) FROM public.notifications x
  ) cur USING (name) LOOP
  IF r.n<>r.n2 OR r.h<>r.h2 THEN RAISE EXCEPTION '081b: % changed outside the two retired rows',r.name;END IF;
 END LOOP;
 IF (SELECT count(*) FROM m081b_others)<>8 THEN RAISE EXCEPTION '081b: snapshot incomplete';END IF;
 -- Not visible on /market (live listings) nor on profile/card lists (statuses those pages show).
 IF EXISTS(SELECT 1 FROM public.listings WHERE card_id=k.card_id AND status IN ('public','early_access'))
  OR EXISTS(SELECT 1 FROM public.cards WHERE id=k.card_id AND status IN ('active','locked','pending_vault')) THEN
  RAISE EXCEPTION '081b: the retired card would still be visible';
 END IF;
END $postguard$;

COMMIT;
