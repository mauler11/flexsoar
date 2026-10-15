-- AUTHOR ONLY / NOT RUN. Commits synthetic fixtures/LOGIN role definitions, no passwords.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
\ir 02_attestation_fixture.sql
CREATE SCHEMA payment_db_workers;
CREATE TABLE payment_db_workers.cases(name text PRIMARY KEY,f jsonb NOT NULL);
INSERT INTO payment_db_workers.cases VALUES('escrow',pg_temp.fixture(0::smallint,3600,false)),('direct',pg_temp.fixture(1::smallint,3600,false)),('operations',pg_temp.fixture(0::smallint,3600));
SELECT public.fn_payment_v2_reconcile_event((f->>'event')::uuid) FROM payment_db_workers.cases WHERE name='operations';
SELECT pg_temp.attest(f,'receipt',30) FROM payment_db_workers.cases WHERE name='operations';
SELECT pg_temp.attest(f,'authentication_pass',31) FROM payment_db_workers.cases WHERE name='operations';
SELECT pg_temp.attest(f,'release',32) FROM payment_db_workers.cases WHERE name='operations';
CREATE FUNCTION payment_db_workers.assert_true(p boolean,label text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',label;END IF;END $$;
CREATE FUNCTION payment_db_workers.expect_error(statement text,fragment text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN IF strpos(SQLERRM,fragment)=0 THEN RAISE;END IF;RETURN;END;RAISE EXCEPTION 'expected rejection: %',statement;END $$;
DO $roles$ DECLARE r text;login name;BEGIN
 FOREACH r IN ARRAY ARRAY['issuer','verifier','settler','executor','notifier'] LOOP
  login:=('payment_db_test_'||r)::name;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=login) THEN RAISE EXCEPTION 'test principal exists: do not repurpose %',login;END IF;
  EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',login);
  EXECUTE format('GRANT %I TO %I','payment_v2_'||r,login);
  EXECUTE format('GRANT USAGE ON SCHEMA payment_db_workers TO %I,%I',login,'payment_v2_'||r);
  EXECUTE format('GRANT SELECT,UPDATE(f) ON payment_db_workers.cases TO %I', 'payment_v2_'||r);
 END LOOP;
END $roles$;
COMMIT;
