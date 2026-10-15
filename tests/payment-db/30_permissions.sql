-- DRAFT / NOT RUN. Real session_user separation; merely SET ROLE under postgres is NOT this test.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
CREATE ROLE payment_db_test_app NOLOGIN NOINHERIT;
GRANT authenticated TO payment_db_test_app;
CREATE ROLE payment_db_test_anon NOLOGIN NOINHERIT;
GRANT anon TO payment_db_test_anon;
CREATE TEMP TABLE permission_fixture AS SELECT pg_temp.fixture(0::smallint) AS f;
SELECT public.fn_payment_v2_reconcile_event((f->>'event')::uuid) FROM permission_fixture;
UPDATE permission_fixture SET f=f||jsonb_build_object('escrow',(SELECT id FROM payment_v2.escrows WHERE attempt_id=(f->>'attempt')::uuid));
GRANT SELECT ON permission_fixture TO authenticated;
DO $temp$ DECLARE n text;BEGIN SELECT nspname INTO n FROM pg_namespace WHERE oid=pg_my_temp_schema();EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated,anon',n);END $temp$;
SET SESSION AUTHORIZATION payment_db_test_app;
SET ROLE authenticated;
SELECT pg_temp.assert_true(NOT pg_has_role(session_user,'payment_v2_verifier','MEMBER'),'ordinary login is not verifier');
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_record_verified_event(''{}'')','permission denied');
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_reconcile_event(gen_random_uuid())','permission denied');
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_record_attestation(''{}'')','permission denied');
SELECT pg_temp.expect_error('INSERT INTO payment_v2.events DEFAULT VALUES','permission denied');
SELECT pg_temp.expect_error('UPDATE payment_v2.attempts SET state=''released''','permission denied');
SELECT pg_temp.expect_error('SELECT public.fn_purchase_card(gen_random_uuid(),gen_random_uuid(),''fabricated'')','permission denied');
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_worker_identity(''payment_v2_verifier'')','permission denied');
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_stage_signed_operation(gen_random_uuid(),gen_random_uuid(),''{}'')','permission denied');
-- A JWT role string must not grant database authority.
SELECT set_config('request.jwt.claims','{"role":"payment_v2_verifier"}',true);
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_record_verified_event(''{}'')','permission denied');
SELECT set_config('request.jwt.claim.sub',f->>'seller',true) FROM permission_fixture;
SELECT pg_temp.assert_true(public.fn_payment_v2_own_attempts((f->>'listing')::uuid)='[]'::jsonb,'seller cannot read buyer attempts') FROM permission_fixture;
SELECT pg_temp.expect_error(format('SELECT public.fn_payment_v2_attach_candidate(%L,%L)',f->>'attempt',repeat('B',88)),'NOT_YOUR_ATTEMPT') FROM permission_fixture;
SELECT set_config('request.jwt.claim.sub',f->>'buyer',true) FROM permission_fixture;
SELECT pg_temp.assert_true(jsonb_array_length(public.fn_payment_v2_own_attempts((f->>'listing')::uuid))=1,'buyer reads immutable attempt') FROM permission_fixture;
SELECT public.fn_payment_v2_attach_candidate((f->>'attempt')::uuid,repeat('B',88)) FROM permission_fixture;
SELECT public.fn_payment_v2_attach_candidate((f->>'attempt')::uuid,repeat('B',88)) FROM permission_fixture;
SELECT pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_decision(%L::jsonb)',jsonb_build_object('escrowId',f->>'escrow','commandId',gen_random_uuid(),'action','refund','expectedRevision','0','pairCommitment',repeat('ab',32),'evidenceDigest',repeat('ab',32),'refundReason','approved_loss')),'STAFF_ROLE_REQUIRED') FROM permission_fixture;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $overloads$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid,p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname IN('fn_purchase_card','fn_purchase_card_core','fn_purchase_card_with_credit','fn_redeem_card','fn_vault_receive','fn_vault_mark_defaulted','fn_confirm_sale_cancellation','fn_accept_trade_offer') OR p.proname LIKE 'fn_purchase_card_%') LOOP
  PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated',f.oid,'EXECUTE') AND NOT has_function_privilege('service_role',f.oid,'EXECUTE') AND NOT has_function_privilege('anon',f.oid,'EXECUTE'),'legacy overload revoked: '||f.sig);
 END LOOP;
END $overloads$;
SET SESSION AUTHORIZATION payment_db_test_anon;
SET ROLE anon;
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_initiate(gen_random_uuid(),gen_random_uuid(),''x'',''x'')','permission denied');
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_record_verified_event(''{}'')','permission denied');
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK;
