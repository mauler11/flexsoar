-- MUST connect as payment_db_test_executor. Admin SET ROLE is not equivalent.
\ir 00_target_guard.sql
BEGIN;
SET LOCAL ROLE payment_v2_executor;
DO $fence$
DECLARE claim jsonb;op uuid;lease uuid;allowed_op uuid;revoke_op uuid;revoke_lease uuid;
 missing_result text;wrong_lease_result text;open_sale_result text;revoke_sale_result text;
 err_state text;err_message text;
BEGIN
 IF session_user<>'payment_db_test_executor' THEN RAISE EXCEPTION 'ASSERT: real executor login required';END IF;
 SELECT operation_id,lease_id INTO op,lease FROM payment_db_executor_fence.cases WHERE name='leased';
 SELECT operation_id INTO allowed_op FROM payment_db_executor_fence.cases WHERE name='allowed_wrong_lease';
 SELECT operation_id,lease_id INTO revoke_op,revoke_lease FROM payment_db_executor_fence.cases WHERE name='revoke';
 claim:=public.fn_payment_v2_claim_operations('00000000-0000-0000-0000-000000000992',10);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(claim) x WHERE x->>'action'='open_sale') THEN RAISE EXCEPTION 'ASSERT: executor claim returned open_sale';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(claim) x WHERE x->>'id'=op::text) THEN RAISE EXCEPTION 'ASSERT: pre-leased open_sale was reclaimed';END IF;
 BEGIN PERFORM public.fn_payment_v2_operation_context(op,lease); RAISE EXCEPTION 'ASSERT: operation context exposed open_sale';
 EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN' THEN RAISE;END IF; END;
 BEGIN PERFORM public.fn_payment_v2_signed_operation(op,lease); RAISE EXCEPTION 'ASSERT: signed operation exposed open_sale';
 EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN' THEN RAISE;END IF; END;
 BEGIN PERFORM public.fn_payment_v2_finish_operation(op,lease,'retry',NULL,'test'); RAISE EXCEPTION 'ASSERT: finish mutated open_sale';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'PAYMENT_V2_OPERATION_LEASE_LOST' THEN RAISE;END IF; END;
 BEGIN PERFORM public.fn_payment_v2_stage_signed_operation(op,lease,NULL); RAISE EXCEPTION 'ASSERT: stage mutated open_sale';
 EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN' THEN RAISE;END IF; END;
 BEGIN
  PERFORM public.fn_payment_v2_finish_operation(gen_random_uuid(),gen_random_uuid(),'retry',NULL,'test');
  err_state:='RETURNED';err_message:='RETURNED';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS err_state=RETURNED_SQLSTATE,err_message=MESSAGE_TEXT; END;
 missing_result:=err_state||'|'||err_message;
 BEGIN
  PERFORM public.fn_payment_v2_finish_operation(allowed_op,gen_random_uuid(),'retry',NULL,'test');
  err_state:='RETURNED';err_message:='RETURNED';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS err_state=RETURNED_SQLSTATE,err_message=MESSAGE_TEXT; END;
 wrong_lease_result:=err_state||'|'||err_message;
 BEGIN
  PERFORM public.fn_payment_v2_finish_operation(op,lease,'retry',NULL,'test');
  err_state:='RETURNED';err_message:='RETURNED';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS err_state=RETURNED_SQLSTATE,err_message=MESSAGE_TEXT; END;
 open_sale_result:=err_state||'|'||err_message;
 BEGIN
  PERFORM public.fn_payment_v2_finish_operation(revoke_op,revoke_lease,'retry',NULL,'test');
  err_state:='RETURNED';err_message:='RETURNED';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS err_state=RETURNED_SQLSTATE,err_message=MESSAGE_TEXT; END;
 revoke_sale_result:=err_state||'|'||err_message;
 IF missing_result<>'P0001|PAYMENT_V2_OPERATION_LEASE_LOST'
  OR wrong_lease_result IS DISTINCT FROM missing_result
  OR open_sale_result IS DISTINCT FROM missing_result
  OR revoke_sale_result IS DISTINCT FROM missing_result THEN
  RAISE EXCEPTION 'ASSERT: finish_operation refusals differ: %, %, %, %',missing_result,wrong_lease_result,open_sale_result,revoke_sale_result;
 END IF;
 RAISE NOTICE 'T092|PASS|real executor cannot claim, view or mutate issuer open_sale operations';
 RAISE NOTICE 'T092|PASS|missing, wrong-lease, open_sale and revoke_sale finish refusals are identical';
END $fence$;
ROLLBACK;
SELECT 'T092|SUITE_PASS';
