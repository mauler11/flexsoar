-- DRAFT / NOT RUN. Single-session idempotency and rollback checks, NOT concurrency proof.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
CREATE FUNCTION pg_temp.attest(f jsonb,a text,seq integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE st payment_v2.staff%rowtype;x payment_v2.escrows%rowtype;d jsonb;p jsonb;op uuid;r text;
BEGIN
 SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE attempt_id=(f->>'attempt')::uuid;
 r:=CASE a WHEN 'receipt' THEN 'receiver' WHEN 'authentication_pass' THEN 'authenticator' WHEN 'authentication_fail' THEN 'authenticator' WHEN 'dispute' THEN 'guardian' WHEN 'review_authentication_pass' THEN 'reviewer' WHEN 'release' THEN 'release' ELSE 'governor' END;
 SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE role=r ORDER BY id LIMIT 1;PERFORM set_config('request.jwt.claim.sub',st.user_id::text,true);
 d:=jsonb_build_object('escrowId',x.id,'commandId',gen_random_uuid(),'expectedRevision',x.decision_revision::text,'action',a,'evidenceDigest',repeat('ab',32),'refundReason','approved_loss','pairCommitment',encode(sha256(uuid_send((f->>'item')::uuid)),'hex'));
 op:=public.fn_payment_v2_record_decision(d);
 IF a IN('refund','resolve_dispute_release','resolve_dispute_refund') THEN
  SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE role='governor' AND user_id<>st.user_id ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',st.user_id::text,true);PERFORM public.fn_payment_v2_approve_refund((d->>'commandId')::uuid);
  SELECT st0.id,st0.user_id,st0.person_id,st0.role,st0.public_key,st0.active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff st0 JOIN payment_v2.decisions dec ON dec.actor_staff=st0.id WHERE dec.id=(d->>'commandId')::uuid;
 END IF;
 p:=jsonb_build_object('commandId',d->>'commandId','finality','finalized','sale',f->'proof'->>'sale','genesis',f->'proof'->>'genesis','program',f->'proof'->>'program','action',a,'evidenceDigest',d->>'evidenceDigest','pairCommitment',d->>'pairCommitment','signature',repeat('7',87)||substr('123456789ABCDEFGHJKLMNPQRSTUVWXYZ',seq,1),'slot',seq+10,'executedAtSeconds',extract(epoch FROM now())::bigint,'resultingRevision',(x.decision_revision+CASE WHEN a IN('release','refund','dispute','resolve_dispute_release','resolve_dispute_refund') THEN 1 ELSE 0 END)::text,'actor',payment_v2.b58(st.public_key));
 PERFORM public.fn_payment_v2_record_attestation(p);RETURN d;
END $$;
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
 PERFORM public.fn_payment_v2_finish_operation((operation->>'id')::uuid,(operation->>'leaseId')::uuid,'submitted',repeat('A',88),NULL);
 -- Expire only the fixture lease/backoff to exercise process restart. No real operation is broadcast.
 UPDATE payment_v2.operations SET available_at=clock_timestamp()-interval '1 second' WHERE id=(operation->>'id')::uuid;
 operation:=public.fn_payment_v2_claim_operations(gen_random_uuid(),10)->0;
 PERFORM pg_temp.assert_true((operation->>'recoveryOnly')::boolean,'signed operation recovers, never new send identity');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_finish_operation(%L,%L,''retry'',%L,NULL)',operation->>'id',operation->>'leaseId',operation->>'signature'),'RECOVERY_ONLY');
 f:=pg_temp.fixture(1::smallint);SELECT count(1) INTO before_count FROM payment_v2.consumptions;
 BEGIN
  PERFORM public.fn_payment_v2_reconcile_event((f->>'event')::uuid);RAISE EXCEPTION 'synthetic post-settlement transaction failure';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'synthetic post-settlement transaction failure' THEN RAISE;END IF;END;
 PERFORM pg_temp.assert_true((SELECT count(1)=before_count FROM payment_v2.consumptions),'whole transaction rolled back');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.orders WHERE payment_v2_attempt_id=(f->>'attempt')::uuid),'rollback leaves no partial order');
END $tests$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
