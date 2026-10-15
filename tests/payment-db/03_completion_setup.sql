-- AUTHOR ONLY / NOT RUN. Run ONCE as isolated migration administrator before tests.
\ir 00_target_guard.sql
BEGIN;
CREATE SCHEMA payment_db_acceptance;
CREATE TABLE payment_db_acceptance.completions(
 scenario text PRIMARY KEY, login name NOT NULL, backend_pid integer NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(), details jsonb NOT NULL
);
REVOKE ALL ON SCHEMA payment_db_acceptance FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON payment_db_acceptance.completions FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
CREATE FUNCTION payment_db_acceptance.assert_true(p boolean,label text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'INCOMPLETE PAYMENT DB SUITE: %',label;END IF;END $$;
-- Test-only recorder. No worker can write/delete completion rows directly or claim
-- an administrative/other-worker checkpoint. Markers commit WITH successful tests.
CREATE FUNCTION payment_db_acceptance.complete(p_scenario text,p_details jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE required_role name;expected_login name;old payment_db_acceptance.completions%rowtype;
BEGIN
 IF p_details IS NULL OR jsonb_typeof(p_details)<>'object' THEN RAISE EXCEPTION 'completion detail required';END IF;
 CASE
 WHEN p_scenario IN('worker:issuer','worker:verifier','worker:settler','worker:executor','worker:notifier') THEN
  required_role:=('payment_v2_'||split_part(p_scenario,':',2))::name;
  expected_login:=('payment_db_test_'||split_part(p_scenario,':',2))::name;
 WHEN p_scenario='signed_storage' THEN required_role:='payment_v2_executor';expected_login:='payment_db_test_executor';
 WHEN p_scenario='stale:operation_takeover' THEN required_role:='payment_v2_executor';expected_login:='payment_db_race_executor_a';
 WHEN p_scenario='stale:outbox_takeover' THEN required_role:='payment_v2_notifier';expected_login:='payment_db_race_notifier_a';
 WHEN p_scenario IN('terminal:release_refund:a','terminal:release_refund:b','terminal:refund_release:a','terminal:refund_release:b','rollback_ack') THEN required_role:='payment_v2_settler';
 WHEN p_scenario IN('core:10','core:20','core:30','expiry','worker_results','duplicate:0:a','duplicate:0:b','duplicate:1:a','duplicate:1:b',
  'race:conflicting_signature','race:conflicting_attempt','race:funding_cancel','race:funding_revoke','race:revoked_funding','race:rollback',
  'race:release_refund','race:refund_release','race:operations','race:outbox','race:operation_takeover','race:outbox_takeover','final') THEN
  IF session_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='payment_db_acceptance.completions'::regclass) THEN RAISE EXCEPTION 'test administrator required';END IF;
 ELSE RAISE EXCEPTION 'unknown completion scenario: %',p_scenario;
 END CASE;
 IF required_role IS NOT NULL THEN
  PERFORM public.fn_payment_v2_worker_identity(required_role);
  IF expected_login IS NOT NULL AND session_user<>expected_login THEN RAISE EXCEPTION 'wrong completion connection';END IF;
 END IF;
 SELECT scenario,login,backend_pid,completed_at,details INTO old FROM payment_db_acceptance.completions WHERE scenario=p_scenario;
 IF FOUND THEN
  IF old.login<>session_user OR old.details IS DISTINCT FROM p_details THEN RAISE EXCEPTION 'completion conflict: %',p_scenario;END IF;RETURN;
 END IF;
 INSERT INTO payment_db_acceptance.completions(scenario,login,backend_pid,details) VALUES(p_scenario,session_user,pg_backend_pid(),p_details);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA payment_db_acceptance FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA payment_db_acceptance TO payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA payment_db_acceptance TO payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
COMMIT;
