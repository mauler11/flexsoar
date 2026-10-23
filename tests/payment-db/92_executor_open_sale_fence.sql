-- MUST connect as payment_db_test_executor. Admin SET ROLE is not equivalent.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_executor;
DO $fence$
DECLARE claim jsonb;op uuid;lease uuid;
BEGIN
 IF session_user<>'payment_db_test_executor' THEN RAISE EXCEPTION 'ASSERT: real executor login required';END IF;
 SELECT operation_id,lease_id INTO op,lease FROM payment_db_executor_fence.cases WHERE name='leased';
 claim:=public.fn_payment_v2_claim_operations('00000000-0000-0000-0000-000000000992',10);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(claim) x WHERE x->>'action'='open_sale') THEN RAISE EXCEPTION 'ASSERT: executor claim returned open_sale';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(claim) x WHERE x->>'id'=op::text) THEN RAISE EXCEPTION 'ASSERT: pre-leased open_sale was reclaimed';END IF;
 BEGIN PERFORM public.fn_payment_v2_operation_context(op,lease); RAISE EXCEPTION 'ASSERT: operation context exposed open_sale';
 EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN' THEN RAISE;END IF; END;
 BEGIN PERFORM public.fn_payment_v2_signed_operation(op,lease); RAISE EXCEPTION 'ASSERT: signed operation exposed open_sale';
 EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN' THEN RAISE;END IF; END;
 BEGIN PERFORM public.fn_payment_v2_finish_operation(op,lease,'retry',NULL,'test'); RAISE EXCEPTION 'ASSERT: finish mutated open_sale';
 EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN' THEN RAISE;END IF; END;
 BEGIN PERFORM public.fn_payment_v2_stage_signed_operation(op,lease,NULL); RAISE EXCEPTION 'ASSERT: stage mutated open_sale';
 EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN' THEN RAISE;END IF; END;
 RAISE NOTICE 'T092|PASS|real executor cannot claim, view or mutate issuer open_sale operations';
END $fence$;
ROLLBACK;
SELECT 'T092|SUITE_PASS';
