-- NOT RUN. Actual dedicated settler connection, after A/B verifier terminal arbitration commits.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_settler;
SELECT public.fn_payment_v2_worker_identity('payment_v2_settler');
SELECT public.fn_payment_v2_reconcile_event((payload->>'event')::uuid) FROM payment_db_races.observations WHERE side='b' AND name=:'race_case' AND name IN('release_refund','refund_release');
-- Exact retry must return the same receipt, without another journal/order/outbox.
SELECT public.fn_payment_v2_reconcile_event((payload->>'event')::uuid) FROM payment_db_races.observations WHERE side='b' AND name=:'race_case' AND name IN('release_refund','refund_release');
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
