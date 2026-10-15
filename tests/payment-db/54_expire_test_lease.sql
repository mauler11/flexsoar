-- DRAFT / NOT RUN. Administrator ONLY; afterA commits its claim, beforeB starts takeover.
\ir 00_target_guard.sql
BEGIN;
-- Expire exactly the committed synthetic A lease; never touch real queue work.
UPDATE payment_v2.operations o SET lease_until=clock_timestamp()-interval '1 second'
 FROM payment_db_races.observations t WHERE t.name='operation_takeover' AND t.side='a' AND o.id=(t.payload->0->>'id')::uuid AND o.lease_id=(t.payload->0->>'leaseId')::uuid;
UPDATE payment_v2.outbox o SET lease_until=clock_timestamp()-interval '1 second'
 FROM payment_db_races.observations t WHERE t.name='outbox_takeover' AND t.side='a' AND o.id=(t.payload->0->>'id')::uuid AND o.lease_id=(t.payload->0->>'leaseId')::uuid;
COMMIT;
