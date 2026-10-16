-- Additive synthetic LOGIN fixtures only. Does not change accepted rows/roles/record.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'flexsoar_payment_v2_test' OR inet_server_addr() IS NULL OR inet_server_addr()<>'127.0.0.1'::inet
 OR NOT EXISTS(SELECT 1 FROM payment_db_acceptance.completions WHERE scenario='final' AND details->>'requiredCheckpoints'='37') THEN RAISE EXCEPTION 'wrong isolated accepted target';END IF;
END $guard$;
DO $roles$ DECLARE label text;login name;BEGIN
 FOREACH label IN ARRAY ARRAY['issuer','verifier','settler','executor','notifier'] LOOP
  login:=('payment_integration_'||label)::name;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=login) THEN RAISE EXCEPTION 'integration LOGIN exists; inspect, never repurpose';END IF;
  EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',login);
  EXECUTE format('GRANT %I TO %I','payment_v2_'||label,login);
 END LOOP;
END $roles$;
COMMIT;
