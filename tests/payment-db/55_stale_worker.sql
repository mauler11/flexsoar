-- DRAFT / NOT RUN. Reuse actual A executor/notifier login after B commits takeover.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE :"worker_role";
SELECT payment_db_races.assert_true(session_user IN('payment_db_race_executor_a','payment_db_race_notifier_a'),'actual original A login');
SELECT payment_db_races.assert_true((SELECT count(1)=1 FROM payment_db_races.observations WHERE side='a' AND name=CASE session_user WHEN 'payment_db_race_executor_a' THEN 'operation_takeover' ELSE 'outbox_takeover' END),'exact original lease observation required');
SELECT payment_db_races.expect_error(format('SELECT public.fn_payment_v2_finish_operation(%L,%L,''retry'',NULL,NULL)',payload->0->>'id',payload->0->>'leaseId'),'LEASE_LOST') FROM payment_db_races.observations WHERE name='operation_takeover' AND side='a' AND session_user='payment_db_race_executor_a';
SELECT payment_db_races.expect_error(format('SELECT public.fn_payment_v2_finish_outbox(%L,%L,true,NULL)',payload->0->>'id',payload->0->>'leaseId'),'LEASE_LOST') FROM payment_db_races.observations WHERE name='outbox_takeover' AND side='a' AND session_user='payment_db_race_notifier_a';
SELECT payment_db_acceptance.complete(CASE session_user WHEN 'payment_db_race_executor_a' THEN 'stale:operation_takeover' ELSE 'stale:outbox_takeover' END,'{}'::jsonb);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
