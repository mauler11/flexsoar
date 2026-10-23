-- AUTHORING ONLY. NOT RUN. Included BEFORE fixtures by every test file.
\set ON_ERROR_STOP on
\if :{?payment_v2_test_ack}
\else
DO $guard$ BEGIN RAISE EXCEPTION 'REFUSING: pass -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY after independent target review'; END $guard$;
\endif
SELECT :'payment_v2_test_ack' = 'ISOLATED_SYNTHETIC_ONLY' AS acknowledged \gset
\if :acknowledged
\else
DO $guard$ BEGIN RAISE EXCEPTION 'REFUSING: payment_v2_test_ack must equal ISOLATED_SYNTHETIC_ONLY'; END $guard$;
\endif
DO $target$ BEGIN
 IF current_database()<>'flexsoar_payment_v2_test' OR inet_server_addr() IS NULL OR inet_server_addr() NOT IN('127.0.0.1'::inet,'::1'::inet)
 OR current_setting('payment_v2.test_identity',true) IS DISTINCT FROM 'synthetic-payment-v2-only' THEN
  RAISE EXCEPTION 'REFUSING: isolated named loopback database + independently configured test marker required';
 END IF;
 IF to_regprocedure('public.fn_payment_v2_reconcile_event(uuid)') IS NULL THEN RAISE EXCEPTION 'apply reviewed059..063 to isolated database first';END IF;
END $target$;
