-- 081b container test, part 2 of 3: AFTER 081b committed on an 85 (variant=main) database. Read-only (ends with ROLLBACK).
-- Exactly two rows changed (the card's status; the intake's status and note), everything else identical to the setup
-- snapshot, the card is invisible to /market and profile/card lists, and no payout path can pick the order up.
\ir 00_target_guard.sql
\set QUIET 1
BEGIN;
CREATE FUNCTION pg_temp.ok(p boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'T086 ASSERT FAILED: %', label; END IF; RETURN 'PASS ' || label; END $$;
CREATE TEMP TABLE now_rows AS
 SELECT 'cards' AS t, to_jsonb(x) AS row FROM public.cards x
 UNION ALL SELECT 'vault_intakes', to_jsonb(x) FROM public.vault_intakes x
 UNION ALL SELECT 'listings', to_jsonb(x) FROM public.listings x
 UNION ALL SELECT 'orders', to_jsonb(x) FROM public.orders x
 UNION ALL SELECT 'items', to_jsonb(x) FROM public.items x
 UNION ALL SELECT 'ledger_entries', to_jsonb(x) FROM public.ledger_entries x
 UNION ALL SELECT 'card_provenance', to_jsonb(x) FROM public.card_provenance x
 UNION ALL SELECT 'notifications', to_jsonb(x) FROM public.notifications x
 UNION ALL SELECT 'redemptions', to_jsonb(x) FROM public.redemptions x;
\unset QUIET
SELECT pg_temp.ok((SELECT v FROM t081b.meta WHERE k = 'variant') = 'main', 'fixtures are variant=main');
-- Rows that differ from the snapshot, either side.
SELECT 'CHANGED|' || d.t || ' ' || (d.row ->> 'id') FROM (
  (SELECT t, row FROM t081b.snap EXCEPT SELECT t, row FROM now_rows)
  UNION ALL (SELECT t, row FROM now_rows EXCEPT SELECT t, row FROM t081b.snap)) d ORDER BY 1;
SELECT pg_temp.ok((SELECT count(*) FROM (SELECT t, row FROM t081b.snap EXCEPT SELECT t, row FROM now_rows) x) = 2
  AND (SELECT count(*) FROM (SELECT t, row FROM now_rows EXCEPT SELECT t, row FROM t081b.snap) x) = 2
  AND (SELECT count(*) FROM t081b.snap) = (SELECT count(*) FROM now_rows), 'exactly two rows changed, none added or removed');
SELECT pg_temp.ok(c.status = 'burned' AND (to_jsonb(c) - 'status') = (s.row - 'status'), 'card: status burned, nothing else changed')
FROM public.cards c JOIN t081b.snap s ON s.t = 'cards' AND (s.row ->> 'id')::uuid = c.id WHERE c.id = '0d90f5e4-b4dc-4783-8b07-c6412df3fd16';
SELECT pg_temp.ok(v.status = 'cancelled' AND v.note LIKE '081b (founder decision 2026-10-22): pre-launch test sale on devnet%'
  AND (to_jsonb(v) - 'status' - 'note') = (s.row - 'status' - 'note'), 'intake: cancelled with the decision note, nothing else changed')
FROM public.vault_intakes v JOIN t081b.snap s ON s.t = 'vault_intakes' AND (s.row ->> 'id')::uuid = v.id WHERE v.id = '4b59ace6-1af4-48aa-9370-b73662a2850e';
SELECT pg_temp.ok(o.status = 'settled' AND NOT o.paid_out AND o.seller_payout = 'cash', 'order kept as history: settled, unpaid')
FROM public.orders o WHERE o.id = '478ef5b4-2cc4-431c-8754-c0f33d3f0e75';
-- Visibility: /market lists 'public' listings (LIVE_LISTING_STATUSES); profiles list active/locked/pending_vault cards.
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.listings WHERE card_id = '0d90f5e4-b4dc-4783-8b07-c6412df3fd16' AND status IN ('public', 'early_access')),
  'not on /market');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.cards WHERE id = '0d90f5e4-b4dc-4783-8b07-c6412df3fd16' AND status IN ('active', 'locked', 'pending_vault')),
  'not on profile or card lists');
-- The noise card and its intake are still exactly as set up.
SELECT pg_temp.ok((SELECT count(*) FROM public.vault_intakes WHERE status = 'awaiting_shipment') = 1
  AND (SELECT count(*) FROM public.cards WHERE status = 'pending_vault') = 1, 'unrelated pending_vault card and open intake untouched');
ROLLBACK;
\echo T086_OK
