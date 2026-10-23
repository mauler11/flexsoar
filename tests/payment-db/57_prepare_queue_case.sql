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
-- A takeover must have only one eligible fixture item. If the sibling remains
-- eligible, B can claim it after A's lease expires instead of taking over A's
-- exact work ID, invalidating the stale-lease assertion.
UPDATE payment_v2.operations o SET ready=false
 FROM payment_db_races.cases c
 WHERE c.name=:'race_case' AND :'race_case'='operation_takeover'
   AND o.id=(SELECT value::text::uuid FROM jsonb_array_elements_text(c.f->'operationIds') OFFSET 1 LIMIT 1);
UPDATE payment_v2.outbox o SET available_at=clock_timestamp()+interval '1 day'
 FROM payment_db_races.cases c
 WHERE c.name=:'race_case' AND :'race_case'='outbox_takeover'
   AND o.id=(SELECT value::text::uuid FROM jsonb_array_elements_text(c.f->'outboxIds') OFFSET 1 LIMIT 1);
COMMIT;
