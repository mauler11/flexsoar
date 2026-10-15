-- NOT RUN. MUST use its own real login connection, not an administrator SET ROLE.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_verifier;
SELECT payment_db_workers.assert_true(session_user='payment_db_test_verifier','actual dedicated login');
SELECT payment_db_workers.assert_true(NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user),'non-superuser');
SELECT payment_db_workers.assert_true(NOT pg_has_role(session_user,'payment_v2_owner','MEMBER') AND NOT pg_has_role(session_user,'service_role','MEMBER') AND NOT pg_has_role(session_user,'authenticator','MEMBER'),'no owner/service/authenticator membership');
SELECT payment_db_workers.assert_true((SELECT count(1) FROM unnest(ARRAY['payment_v2_issuer','payment_v2_verifier','payment_v2_settler','payment_v2_executor','payment_v2_notifier']) r(name) WHERE pg_has_role(session_user,r.name::name,'MEMBER'))=1,'one worker membership');
SELECT payment_db_workers.assert_true(public.fn_payment_v2_worker_identity('payment_v2_verifier')->>'login'=session_user::text,'RPC reports session_user');
SELECT payment_db_workers.expect_error('UPDATE public.users SET handle=handle','permission denied');
SELECT payment_db_workers.expect_error('UPDATE public.cards SET status=status','permission denied');
SELECT payment_db_workers.expect_error('INSERT INTO payment_v2.events DEFAULT VALUES','permission denied');
UPDATE payment_db_workers.cases SET f=f||jsonb_build_object('event',public.fn_payment_v2_record_verified_event((f->'proof')||jsonb_build_object('permitHex',f->>'permit'))) WHERE name IN('escrow','direct');
SELECT public.fn_payment_v2_recovery_binding(f->'proof'->>'attempt',f->'proof'->>'genesis',f->'proof'->>'program') FROM payment_db_workers.cases WHERE name='escrow';
SELECT payment_db_workers.expect_error('SELECT public.fn_payment_v2_authorize_attempt(gen_random_uuid())','permission denied');
SELECT payment_db_acceptance.complete('worker:verifier','{}'::jsonb);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
