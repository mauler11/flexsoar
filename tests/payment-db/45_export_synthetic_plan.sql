-- NOT RUN. Dedicated executor, -X -q -At; output is public synthetic plan+lease, no keys.
\ir 00_target_guard.sql
BEGIN READ ONLY;
SET LOCAL ROLE payment_v2_executor;
SELECT jsonb_build_object('leaseId',op->>'leaseId','plan',public.fn_payment_v2_signed_operation((op->>'id')::uuid,(op->>'leaseId')::uuid)->'plan')
 FROM payment_db_workers.cases CROSS JOIN LATERAL jsonb_array_elements(f->'leases') op WHERE name='operations' AND op->>'action'='execute_outcome';
COMMIT;
