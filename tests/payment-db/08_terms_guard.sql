-- Actual shared trigger on all four production tables. Synthetic rows roll back.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
DO $tests$ DECLARE f jsonb;other jsonb;s uuid;a uuid;op uuid;job uuid;e uuid;BEGIN
 f:=pg_temp.fixture(0::smallint);other:=pg_temp.fixture(1::smallint);
 s:=(f->>'sale')::uuid;a:=(f->>'attempt')::uuid;e:=(f->>'event')::uuid;
 UPDATE payment_v2.sales SET state='cancel_requested' WHERE id=s;
 PERFORM pg_temp.assert_true((SELECT state='cancel_requested' FROM payment_v2.sales WHERE id=s),'sales allowed state update');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.sales SET price_cents=price_cents+1 WHERE id=%L',s),'TERMS_IMMUTABLE');
 UPDATE payment_v2.attempts SET state='unresolved' WHERE id=a;
 PERFORM pg_temp.assert_true((SELECT state='unresolved' FROM payment_v2.attempts WHERE id=a),'attempt allowed state update');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.attempts SET gross_cents=gross_cents+1 WHERE id=%L',a),'TERMS_IMMUTABLE');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.attempts SET permit=decode(repeat(''00'',690),''hex'') WHERE id=%L',a),'PERMIT_IMMUTABLE');
 op:=payment_v2.enqueue(s,'synthetic_guard_only','{}',1);
 UPDATE payment_v2.operations SET state='leased',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',leased_by=session_user WHERE id=op;
 PERFORM pg_temp.assert_true((SELECT state='leased' AND lease_id IS NOT NULL FROM payment_v2.operations WHERE id=op),'operation allowed state/lease update');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.operations SET payload=''true''::jsonb WHERE id=%L',op),'TERMS_IMMUTABLE');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.operations SET resolved_event=%L WHERE id=%L',other->>'event',op),'OPERATION_RESOLUTION_CONFLICT');
 UPDATE payment_v2.operations SET resolved_event=e,signature=repeat('2',88) WHERE id=op;
 PERFORM pg_temp.assert_true((SELECT resolved_event=e AND signature=repeat('2',88) FROM payment_v2.operations WHERE id=op),'same-sale resolution and first signature accepted');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.operations SET signature=repeat(''3'',88) WHERE id=%L',op),'OPERATION_IDENTITY_IMMUTABLE');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.operations SET signature=NULL WHERE id=%L',op),'OPERATION_IDENTITY_IMMUTABLE');
 INSERT INTO payment_v2.outbox(event_id,user_id,kind,payload) VALUES(e,(f->>'buyer')::uuid,'synthetic_guard_only','{}') RETURNING id INTO job;
 UPDATE payment_v2.outbox SET state='leased',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',leased_by=session_user WHERE id=job;
 PERFORM pg_temp.assert_true((SELECT state='leased' AND lease_id IS NOT NULL FROM payment_v2.outbox WHERE id=job),'outbox allowed state/lease update');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.outbox SET payload=''true''::jsonb WHERE id=%L',job),'TERMS_IMMUTABLE');
END $tests$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
-- Reached only after all assertions and rollback succeeded. Do not rerun once committed.
BEGIN;
CREATE SCHEMA payment_db_repairs;
CREATE TABLE payment_db_repairs.completions(scenario text PRIMARY KEY,login name NOT NULL DEFAULT session_user,completed_at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON SCHEMA payment_db_repairs FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
REVOKE ALL ON payment_db_repairs.completions FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
INSERT INTO payment_db_repairs.completions(scenario) VALUES('terms_guard');
COMMIT;
\echo 'TERMS_GUARD_REGRESSION_COMPLETE'
