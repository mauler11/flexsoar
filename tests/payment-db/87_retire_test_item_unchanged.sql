-- 081b container test, part 3 of 3: after 081b was REFUSED (any variant, or before 081b ran), every row is exactly as 85 set
-- it up. Read-only (ends with ROLLBACK).
\ir 00_target_guard.sql
\set QUIET 1
BEGIN;
CREATE FUNCTION pg_temp.ok(p boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'T087 ASSERT FAILED: %', label; END IF; RETURN 'PASS ' || label; END $$;
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
SELECT 'UNCHANGED|variant=' || v FROM t081b.meta WHERE k = 'variant';
SELECT pg_temp.ok(NOT EXISTS (SELECT t, row FROM t081b.snap EXCEPT SELECT t, row FROM now_rows)
  AND NOT EXISTS (SELECT t, row FROM now_rows EXCEPT SELECT t, row FROM t081b.snap), 'every row identical to the setup snapshot');
ROLLBACK;
\echo T087_OK
