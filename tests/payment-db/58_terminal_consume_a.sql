-- NOT RUN. Actual settler connection after canonical verifier A/B arbitration commits.
-- Interactive psql only: leave transaction open, start59, observe blocking, then COMMIT.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_settler;
SET LOCAL statement_timeout='120s';
SELECT public.fn_payment_v2_worker_identity('payment_v2_settler');
SELECT payment_db_races.assert_true(:'race_case' IN('release_refund','refund_release'),'terminal case');
INSERT INTO payment_db_races.observations(name,side,payload)
 SELECT name,'consume_a',public.fn_payment_v2_reconcile_event((payload->>'event')::uuid)
 FROM payment_db_races.observations WHERE name=:'race_case' AND side='b'
 RETURNING name,side,payload,login;
SET CONSTRAINTS ALL IMMEDIATE;
-- HUMAN COMMIT after59 is waiting; no implicit commit here.
