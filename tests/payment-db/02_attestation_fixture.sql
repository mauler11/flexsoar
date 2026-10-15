-- DRAFT ONLY / NOT RUN. Include after01_fixtures inside guarded test session.
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
 p:=jsonb_build_object('commandId',d->>'commandId','finality','finalized','sale',f->'proof'->>'sale','genesis',f->'proof'->>'genesis','program',f->'proof'->>'program','action',a,'evidenceDigest',d->>'evidenceDigest','pairCommitment',d->>'pairCommitment','signature',payment_v2.b58(sha512(uuid_send((d->>'commandId')::uuid))),'slot',seq+10,'executedAtSeconds',extract(epoch FROM now())::bigint,'resultingRevision',(x.decision_revision+CASE WHEN a IN('release','refund','dispute','resolve_dispute_release','resolve_dispute_refund') THEN 1 ELSE 0 END)::text,'actor',payment_v2.b58(st.public_key));
 PERFORM public.fn_payment_v2_record_attestation(p);RETURN d;
END $$;
