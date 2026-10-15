-- DRAFT / NOT RUN. Single-session idempotency and rollback checks, NOT concurrency proof.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
\ir 02_attestation_fixture.sql
DO $tests$
DECLARE f jsonb;r jsonb;r2 jsonb;decision jsonb;e uuid;kind text;i integer:=0;operation jsonb;outbox jsonb;scan jsonb;before_count bigint;
BEGIN
 FOREACH kind IN ARRAY ARRAY['released','refunded'] LOOP
  i:=i+1;f:=pg_temp.fixture(0::smallint);PERFORM public.fn_payment_v2_reconcile_event((f->>'event')::uuid);
  IF kind='released' THEN PERFORM pg_temp.attest(f,'receipt',i*4);PERFORM pg_temp.attest(f,'authentication_pass',i*4+1);decision:=pg_temp.attest(f,'release',i*4+2);
  ELSE decision:=pg_temp.attest(f,'refund',i*4+2);END IF;
  f:=f||jsonb_build_object('terminalProof',(f->'proof')||jsonb_build_object('kind',kind,'signature',repeat('8',87)||i::text,'slot',30+i,'decisionRevision','1'));
  e:=public.fn_payment_v2_record_verified_event(f->'terminalProof');
  r:=public.fn_payment_v2_reconcile_event(e);r2:=public.fn_payment_v2_reconcile_event(e);PERFORM pg_temp.assert_true(r=r2,'terminal exact retry');
  PERFORM pg_temp.assert_true((SELECT state=kind FROM payment_v2.escrows WHERE attempt_id=(f->>'attempt')::uuid),'terminal state');
  PERFORM pg_temp.assert_true((SELECT sum(units)=0 FROM payment_v2.usdc_journal WHERE event_id=e),'terminal USDC journal');
  IF kind='refunded' THEN
   PERFORM pg_temp.assert_true((SELECT units=5000000 FROM payment_v2.usdc_journal WHERE event_id=e AND account='wallet:'||payment_v2.b58(sha256(uuid_send((f->>'buyer')::uuid)))),'FULL principal, fee included');
   PERFORM pg_temp.assert_true((SELECT owner_id=(f->>'seller')::uuid AND status='locked' FROM public.cards WHERE id=(f->>'card')::uuid),'refund reverses conditional ownership and quarantines');
  ELSE
   PERFORM pg_temp.assert_true((SELECT status='active' FROM public.cards WHERE id=(f->>'card')::uuid),'released DB claim remains sale-fenced until chain ack');
  END IF;
  PERFORM pg_temp.assert_true((SELECT fence AND NOT chain_acknowledged FROM payment_v2.sales WHERE id=(f->>'sale')::uuid),'ack outstanding after financial commit');
  PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_verified_event(%L::jsonb)',(f->'terminalProof')||jsonb_build_object('kind',CASE kind WHEN 'released' THEN 'refunded' ELSE 'released' END,'signature',repeat('9',88))),'CONFLICTING_EVIDENCE');
  -- A failed outbox insertion must roll back consumption, ownership and accounting together.
  outbox:=public.fn_payment_v2_claim_outbox(20)->0;
  PERFORM public.fn_payment_v2_finish_outbox((outbox->>'id')::uuid,(outbox->>'leaseId')::uuid,false,'synthetic delivery failure');
  PERFORM pg_temp.assert_true((SELECT count(1)=2 FROM payment_v2.consumptions WHERE order_id=(r->>'orderId')::uuid),'notification failure leaves financial settlement intact');
  PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_finish_outbox(%L,%L,true,NULL)',outbox->>'id',gen_random_uuid()),'LEASE_LOST');
  scan:=public.fn_payment_v2_begin_scan(f->'proof'->>'genesis',f->'proof'->>'program',20);
  PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_begin_scan(%L,%L,20)',f->'proof'->>'genesis',f->'proof'->>'program'),'SCAN_BUSY');
  PERFORM public.fn_payment_v2_finish_scan((scan->>'leaseId')::uuid,NULL,jsonb_build_array(jsonb_build_object('sale',f->'proof'->>'sale','error','synthetic unresolved')));
 END LOOP;
 -- Independent review + two-person resolution clears a hold but still cannot release money/unlock.
 f:=pg_temp.fixture(0::smallint);PERFORM public.fn_payment_v2_reconcile_event((f->>'event')::uuid);
 PERFORM pg_temp.attest(f,'receipt',20);PERFORM pg_temp.attest(f,'authentication_fail',21);PERFORM pg_temp.attest(f,'dispute',22);
 PERFORM pg_temp.assert_true((SELECT held AND authentication='fail' FROM payment_v2.escrows WHERE attempt_id=(f->>'attempt')::uuid),'dispute hold retained');
 PERFORM pg_temp.attest(f,'review_authentication_pass',23);PERFORM pg_temp.attest(f,'resolve_dispute_release',24);
 PERFORM pg_temp.assert_true((SELECT NOT held AND authentication='pass' AND state='funded' FROM payment_v2.escrows WHERE attempt_id=(f->>'attempt')::uuid),'review is not financial release');
 PERFORM pg_temp.assert_true((SELECT status='pending_vault' FROM public.cards WHERE id=(f->>'card')::uuid),'resolution alone cannot unlock');
 PERFORM pg_temp.attest(f,'release',25);
 operation:=public.fn_payment_v2_claim_operations(gen_random_uuid(),10)->0;
 -- Signature-only submission is no longer a valid durable operation.
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_finish_operation(%L,%L,''submitted'',%L,NULL)',operation->>'id',operation->>'leaseId',repeat('A',88)),'DURABLE_SIGNED_BYTES_REQUIRED');
 f:=pg_temp.fixture(1::smallint);SELECT count(1) INTO before_count FROM payment_v2.consumptions;
 BEGIN
  PERFORM public.fn_payment_v2_reconcile_event((f->>'event')::uuid);RAISE EXCEPTION 'synthetic post-settlement transaction failure';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'synthetic post-settlement transaction failure' THEN RAISE;END IF;END;
 PERFORM pg_temp.assert_true((SELECT count(1)=before_count FROM payment_v2.consumptions),'whole transaction rolled back');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.orders WHERE payment_v2_attempt_id=(f->>'attempt')::uuid),'rollback leaves no partial order');
END $tests$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;

-- Reached only after every assertion and the intentional fixture rollback succeeded.
SELECT payment_db_acceptance.complete('core:20','{}'::jsonb);
