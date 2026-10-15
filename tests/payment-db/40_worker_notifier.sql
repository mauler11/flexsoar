-- NOT RUN. MUST use its own real login connection, not an administrator SET ROLE.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_notifier;
SELECT payment_db_workers.assert_true(session_user='payment_db_test_notifier','actual dedicated login');
SELECT payment_db_workers.assert_true(NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user),'non-superuser');
SELECT payment_db_workers.assert_true(NOT pg_has_role(session_user,'payment_v2_owner','MEMBER') AND NOT pg_has_role(session_user,'service_role','MEMBER') AND NOT pg_has_role(session_user,'authenticator','MEMBER'),'no owner/service/authenticator membership');
SELECT payment_db_workers.assert_true((SELECT count(1) FROM unnest(ARRAY['payment_v2_issuer','payment_v2_verifier','payment_v2_settler','payment_v2_executor','payment_v2_notifier']) r(name) WHERE pg_has_role(session_user,r.name::name,'MEMBER'))=1,'one worker membership');
SELECT payment_db_workers.assert_true(public.fn_payment_v2_worker_identity('payment_v2_notifier')->>'login'=session_user::text,'RPC reports session_user');
SELECT payment_db_workers.expect_error('UPDATE public.users SET handle=handle','permission denied');
SELECT payment_db_workers.expect_error('UPDATE public.cards SET status=status','permission denied');
SELECT payment_db_workers.expect_error('INSERT INTO payment_v2.events DEFAULT VALUES','permission denied');
UPDATE payment_db_workers.cases SET f=f||jsonb_build_object('jobs',public.fn_payment_v2_claim_outbox(20)) WHERE name='operations';
SELECT payment_db_workers.assert_true(jsonb_array_length(f->'jobs')>0,'outbox was leased') FROM payment_db_workers.cases WHERE name='operations';
SELECT public.fn_payment_v2_finish_outbox((job->>'id')::uuid,(job->>'leaseId')::uuid,false,'synthetic provider unavailable') FROM payment_db_workers.cases CROSS JOIN LATERAL jsonb_array_elements(f->'jobs') job WHERE name='operations';
SELECT payment_db_workers.expect_error('SELECT public.fn_payment_v2_claim_operations(gen_random_uuid(),1)','permission denied');
SELECT payment_db_acceptance.complete('worker:notifier','{}'::jsonb);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
