-- MUST connect as payment_db_test_issuer. Proves executor fencing leaves issuer route available.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_issuer;
DO $queue$
DECLARE expected uuid;rows jsonb;
BEGIN
 IF session_user<>'payment_db_test_issuer' THEN RAISE EXCEPTION 'ASSERT: real issuer login required';END IF;
 SELECT (f->>'sale')::uuid INTO expected FROM payment_db_executor_fence.cases WHERE name='claim';
 rows:=public.fn_payment_v2_open_sale_queue(1);
 IF jsonb_array_length(rows)<>1 OR rows->0->>'saleId'<>expected::text THEN RAISE EXCEPTION 'ASSERT: issuer queue did not return eligible open_sale';END IF;
 RAISE NOTICE 'T093|PASS|dedicated issuer still reads its signed open-sale queue';
END $queue$;
ROLLBACK;
SELECT 'T093|SUITE_PASS';
