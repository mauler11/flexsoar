-- NOT RUN. Isolated administrator ONLY, BEFORE each queue case; changes synthetic queue eligibility/time only.
\ir 00_target_guard.sql
BEGIN;
SELECT payment_db_races.assert_true(:'race_case' IN('operations','outbox','operation_takeover','outbox_takeover'),'known synthetic queue case');
UPDATE payment_v2.operations SET ready=false WHERE state<>'observed';
UPDATE payment_v2.outbox SET available_at=clock_timestamp()+interval '1 day' WHERE state<>'delivered';
UPDATE payment_v2.operations o SET ready=true,available_at=clock_timestamp(),lease_until=clock_timestamp()-interval '1 second'
 FROM payment_db_races.cases c WHERE c.name=:'race_case' AND o.id IN(SELECT value::text::uuid FROM jsonb_array_elements_text(c.f->'operationIds'));
UPDATE payment_v2.outbox o SET available_at=clock_timestamp(),lease_until=clock_timestamp()-interval '1 second'
 FROM payment_db_races.cases c WHERE c.name=:'race_case' AND o.id IN(SELECT value::text::uuid FROM jsonb_array_elements_text(c.f->'outboxIds'));
COMMIT;
