-- Run only after06 export + offline production-TS comparison; reruns primitive assertions.
\ir 05_encoding.sql
BEGIN;
CREATE SCHEMA payment_db_codec;
CREATE TABLE payment_db_codec.completion(scenario text PRIMARY KEY,login name NOT NULL DEFAULT session_user,completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),comparison jsonb NOT NULL);
REVOKE ALL ON SCHEMA payment_db_codec FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
REVOKE ALL ON payment_db_codec.completion FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
CREATE TEMP TABLE comparison_input(value jsonb);
INSERT INTO comparison_input VALUES(:'comparison_json'::jsonb);
DO $verify$ DECLARE j jsonb;BEGIN
 SELECT value INTO j FROM comparison_input;
 IF NOT (j ?& ARRAY['actual','expected','encoder','sha256','model']) OR j->>'actual' IS NULL OR j->>'expected' IS NULL OR j->>'actual' !~ '^[0-9a-f]+$' OR j->>'actual' IS DISTINCT FROM j->>'expected' OR length(j->>'actual')<>1380 OR j->>'encoder' IS DISTINCT FROM 'production protocol-v2.ts encodePermit'
 OR encode(sha256(decode(j->>'actual','hex')),'hex') IS DISTINCT FROM j->>'sha256' THEN RAISE EXCEPTION 'SQL/TS permit comparison failed';END IF;
 INSERT INTO payment_db_codec.completion(scenario,comparison) VALUES('encoding',j);
END $verify$;
COMMIT;
\echo 'CODEC_ENCODING_ACCEPTANCE_COMPLETE: committed primitive + actual SQL/TS permit evidence'
