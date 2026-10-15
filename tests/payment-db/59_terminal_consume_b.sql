-- NOT RUN. Separate actual settler connection while58 holds financial locks.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_settler;
SET LOCAL statement_timeout='120s';
SELECT public.fn_payment_v2_worker_identity('payment_v2_settler');
SELECT payment_db_races.assert_true(:'race_case' IN('release_refund','refund_release'),'terminal case');
INSERT INTO payment_db_races.observations(name,side,payload)
 SELECT name,'consume_b',public.fn_payment_v2_reconcile_event((payload->>'event')::uuid)
 FROM payment_db_races.observations WHERE name=:'race_case' AND side='b'
 RETURNING name,side,payload,login;
SELECT payment_db_acceptance.assert_true((SELECT count(1)=1 FROM payment_db_races.observations WHERE name=:'race_case' AND side='consume_b'),'actual terminal consumption row required');
SELECT payment_db_acceptance.complete('terminal:'||:'race_case'||':b','{}'::jsonb);
SET CONSTRAINTS ALL IMMEDIATE;
-- HUMAN COMMIT after58 commits and this result returns. Run53 afterward.
