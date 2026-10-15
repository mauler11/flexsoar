-- NOT RUN. SAME interactive A backend immediately AFTER ROLLBACK of51's rollback case.
-- Explicit human acknowledgement of the observed rollback; cannot prove the human
-- inspected B's lock wait. Preserve transcripts/pg_locks evidence independently.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_settler;
SELECT public.fn_payment_v2_worker_identity('payment_v2_settler');
SELECT payment_db_acceptance.assert_true(NOT EXISTS(SELECT 1 FROM payment_db_races.observations WHERE name='rollback' AND side='a'),'A provisional writes rolled back');
SELECT payment_db_acceptance.complete('rollback_ack','{"humanConfirmedRollback":true}'::jsonb);
COMMIT;
