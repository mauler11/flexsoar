-- DRAFT / NOT RUN. Blocks until A commits.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL statement_timeout='60s';
SELECT public.fn_payment_v2_reconcile_event((f->>'event')::uuid) AS same_receipt FROM payment_db_test.races WHERE id=:'race_mode'::integer;
COMMIT;
SELECT count(1)=1 AS exactly_one_order FROM public.orders o JOIN payment_db_test.races r ON o.payment_v2_attempt_id=(r.f->>'attempt')::uuid WHERE r.id=:'race_mode'::integer;
SELECT count(1)=1 AS exactly_one_consumption FROM payment_v2.consumptions c JOIN payment_db_test.races r ON c.event_id=(r.f->>'event')::uuid WHERE r.id=:'race_mode'::integer;
-- Printed booleans alone are not acceptance. Assert and record explicit success.
BEGIN;
SELECT payment_db_acceptance.assert_true((SELECT count(1)=1 FROM public.orders o JOIN payment_db_test.races r ON o.payment_v2_attempt_id=(r.f->>'attempt')::uuid WHERE r.id=:'race_mode'::integer),'exact duplicate order');
SELECT payment_db_acceptance.assert_true((SELECT count(1)=1 FROM payment_v2.consumptions c JOIN payment_db_test.races r ON c.event_id=(r.f->>'event')::uuid WHERE r.id=:'race_mode'::integer),'exact duplicate consumption');
SELECT payment_db_acceptance.complete('duplicate:'||:'race_mode'||':b','{}'::jsonb);
COMMIT;
