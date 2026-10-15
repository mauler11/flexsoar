-- DRAFT / NOT RUN. Human supplies -v race_mode=0 or1.
\ir 00_target_guard.sql
BEGIN;
SELECT public.fn_payment_v2_reconcile_event((f->>'event')::uuid) AS original_receipt FROM payment_db_test.races WHERE id=:'race_mode'::integer;
SELECT payment_db_acceptance.assert_true((SELECT count(1)=1 FROM payment_db_test.races WHERE id=:'race_mode'::integer),'exact duplicate fixture required');
SELECT payment_db_acceptance.complete('duplicate:'||:'race_mode'||':a','{}'::jsonb);
-- Leave transaction OPEN while sessionB starts. Human COMMIT after confirming B blocks.
