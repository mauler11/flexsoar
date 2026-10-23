-- Administrator-only postcondition: rejected executor calls left both issuer operations unchanged.
\ir 00_target_guard.sql
DO $assert$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_db_executor_fence.cases c JOIN payment_v2.operations o ON o.id=c.operation_id
  WHERE c.name='leased' AND o.action='open_sale' AND o.state='leased' AND o.lease_id=c.lease_id
   AND o.leased_by='payment_db_test_executor' AND o.signature IS NULL) THEN
  RAISE EXCEPTION 'ASSERT: fenced leased issuer operation changed';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_db_executor_fence.cases c JOIN payment_v2.operations o ON o.id=c.operation_id
  WHERE c.name='claim' AND o.action='open_sale' AND o.state='pending' AND o.lease_id IS NULL AND o.leased_by IS NULL) THEN
  RAISE EXCEPTION 'ASSERT: excluded issuer operation was claimed';
 END IF;
 RAISE NOTICE 'T094|PASS|executor refusals leave issuer operations unchanged';
END $assert$;
SELECT 'T094|SUITE_PASS';
