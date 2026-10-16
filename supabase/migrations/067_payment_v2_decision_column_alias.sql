-- Mechanical PL/pgSQL column/local-variable collision only; applied061 unchanged.
BEGIN;
CREATE TEMP TABLE decision_alias_before ON COMMIT DROP AS SELECT oid,to_jsonb(p)-'prosrc' AS metadata,prosrc FROM pg_proc p WHERE oid='public.fn_payment_v2_record_decision(jsonb)'::regprocedure;
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM decision_alias_before WHERE encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex')='84565d4d2d881d623a9cae49f10caa4fd95d40399e44fb3091e95a7b3fdfc4df') THEN RAISE EXCEPTION 'unexpected decision body: inspect before alias correction';END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.fn_payment_v2_record_decision(p_decision jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=payment_v2.actor();x payment_v2.escrows%rowtype;s payment_v2.sales%rowtype;st payment_v2.staff%rowtype;d payment_v2.decisions%rowtype;
 action text:=p_decision->>'action';cmd uuid:=(p_decision->>'commandId')::uuid;required_role text;v_op uuid;v_person uuid;
BEGIN
 required_role:=CASE action WHEN 'receipt' THEN 'receiver' WHEN 'authentication_pass' THEN 'authenticator' WHEN 'authentication_fail' THEN 'authenticator' WHEN 'release' THEN 'release' WHEN 'refund' THEN 'governor' WHEN 'dispute' THEN 'guardian' WHEN 'review_authentication_pass' THEN 'reviewer' WHEN 'review_authentication_fail' THEN 'reviewer' WHEN 'resolve_dispute_release' THEN 'governor' WHEN 'resolve_dispute_refund' THEN 'governor' END;
 SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE user_id=u AND role=required_role AND active;
 IF st.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_STAFF_ROLE_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=(p_decision->>'escrowId')::uuid;PERFORM payment_v2.lock_sale(x.sale_id);
 SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=x.id FOR UPDATE;SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=x.sale_id;
 SELECT id,escrow_id,decision_row.action,expected_revision,actor_staff,person_id,pair_commitment,evidence_digest,payload,created_at INTO d.id,d.escrow_id,d.action,d.expected_revision,d.actor_staff,d.person_id,d.pair_commitment,d.evidence_digest,d.payload,d.created_at FROM payment_v2.decisions decision_row WHERE id=cmd;
 IF FOUND THEN
  IF d.payload IS DISTINCT FROM p_decision OR d.actor_staff<>st.id THEN RAISE EXCEPTION 'PAYMENT_V2_DECISION_REUSE_CONFLICT';END IF;
  SELECT id INTO v_op FROM payment_v2.operations WHERE decision_id=d.id;RETURN v_op;
 END IF;
 IF x.id IS NULL OR x.state<>'funded' OR x.decision_revision<>(p_decision->>'expectedRevision')::numeric
 OR decode(p_decision->>'pairCommitment','hex') IS DISTINCT FROM (SELECT pair_commitment FROM payment_v2.inventory WHERE card_id=s.card_id)
 OR p_decision->>'evidenceDigest' IS NULL OR p_decision->>'expectedRevision' IS NULL OR p_decision->>'evidenceDigest' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'PAYMENT_V2_DECISION_CONTEXT';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cards c JOIN payment_v2.attempts a ON a.card_id=c.id AND a.id=x.attempt_id WHERE c.id=s.card_id AND c.owner_id=a.buyer_id AND c.status='pending_vault' AND payment_v2.owns_claim(c.id,a.buyer_id)) THEN RAISE EXCEPTION 'PAYMENT_V2_CONDITIONAL_OWNER_CONFLICT';END IF;
 IF (x.held AND action NOT IN('dispute','review_authentication_pass','review_authentication_fail','resolve_dispute_release','resolve_dispute_refund')) OR EXISTS(SELECT 1 FROM payment_v2.decisions pending JOIN payment_v2.operations op ON op.decision_id=pending.id WHERE pending.escrow_id=x.id AND op.state<>'observed') THEN RAISE EXCEPTION 'PAYMENT_V2_DECISION_PENDING_OR_HELD';END IF;
 IF (action='receipt' AND x.received_at IS NOT NULL) OR (action IN('authentication_pass','authentication_fail') AND x.authentication<>'pending') OR (action NOT IN('dispute','resolve_dispute_release','resolve_dispute_refund','review_authentication_pass','review_authentication_fail') AND NOT EXISTS(SELECT 1 FROM payment_v2.decisions resolution JOIN payment_v2.attestations ra ON ra.decision_id=resolution.id WHERE resolution.escrow_id=x.id AND resolution.action='resolve_dispute_release' AND ra.resulting_revision=x.decision_revision) AND EXISTS(SELECT 1 FROM payment_v2.decisions fd JOIN payment_v2.attestations ft ON ft.decision_id=fd.id WHERE fd.escrow_id=x.id AND fd.action IN('release','refund'))) THEN RAISE EXCEPTION 'PAYMENT_V2_ALREADY_ATTESTED';END IF;
 IF action IN('authentication_pass','authentication_fail','release') AND x.received_at IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_RECEIPT_REQUIRED';END IF;
 IF action IN('review_authentication_pass','review_authentication_fail') AND (NOT x.held OR x.authentication<>'fail' OR EXISTS(SELECT 1 FROM payment_v2.decisions rd JOIN payment_v2.attestations rt ON rt.decision_id=rd.id WHERE rd.escrow_id=x.id AND rd.action IN('review_authentication_pass','review_authentication_fail'))) THEN RAISE EXCEPTION 'PAYMENT_V2_REVIEW_CONTEXT';END IF;
 IF action LIKE 'resolve_dispute_%' AND (NOT x.held OR (action='resolve_dispute_release' AND (x.received_at IS NULL OR x.authentication<>'pass'))) THEN RAISE EXCEPTION 'PAYMENT_V2_DISPUTE_CONTEXT';END IF;
 IF action='release' AND x.authentication<>'pass' THEN RAISE EXCEPTION 'PAYMENT_V2_AUTHENTICATION_REQUIRED';END IF;
 IF action IN('authentication_pass','authentication_fail','review_authentication_pass','review_authentication_fail','release') AND EXISTS(
  SELECT 1 FROM payment_v2.decisions prev JOIN payment_v2.attestations t ON t.decision_id=prev.id
  WHERE prev.escrow_id=x.id AND prev.person_id=st.person_id AND prev.action IN('receipt','authentication_pass','authentication_fail','review_authentication_pass','review_authentication_fail')) THEN RAISE EXCEPTION 'PAYMENT_V2_INDEPENDENT_PERSON_REQUIRED';END IF;
 IF action IN('refund','resolve_dispute_refund') THEN
  IF p_decision->>'refundReason' IS NULL OR p_decision->>'refundReason' NOT IN('seller_default','authentication_rejection','approved_loss') THEN RAISE EXCEPTION 'PAYMENT_V2_REFUND_REASON_REQUIRED';END IF;
  IF p_decision->>'refundReason'='seller_default' AND (x.received_at IS NOT NULL OR clock_timestamp()<x.dispatch_due+interval '24 hours' OR x.dispatch_evidence IN('carrier_accepted','reviewed_dropoff')) THEN RAISE EXCEPTION 'PAYMENT_V2_TRANSIT_IS_NOT_DEFAULT';END IF;
  IF p_decision->>'refundReason'='authentication_rejection' AND (x.authentication<>'fail' OR NOT EXISTS(SELECT 1 FROM payment_v2.decisions ad JOIN payment_v2.attestations at ON at.decision_id=ad.id WHERE ad.escrow_id=x.id AND ad.action='authentication_fail' AND to_timestamp((at.proof->>'executedAtSeconds')::bigint)+interval '48 hours'<=clock_timestamp())) THEN RAISE EXCEPTION 'PAYMENT_V2_REJECTION_CHALLENGE_WINDOW';END IF;
  -- approved_loss is an explicit manual 2-of-3 governance finding, never a timer.
 END IF;
 INSERT INTO payment_v2.decisions VALUES(cmd,x.id,action,x.decision_revision,st.id,st.person_id,decode(p_decision->>'pairCommitment','hex'),decode(p_decision->>'evidenceDigest','hex'),p_decision,now());
 v_op:=payment_v2.enqueue(s.id,action,p_decision,x.decision_revision,cmd,cmd,action NOT IN('refund','resolve_dispute_release','resolve_dispute_refund'));
 IF action IN('refund','resolve_dispute_release','resolve_dispute_refund') THEN INSERT INTO payment_v2.governance_approvals VALUES(cmd,st.id,st.person_id);END IF;
 RETURN v_op;
END $$;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM decision_alias_before b JOIN pg_proc p ON p.oid=b.oid WHERE b.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc'
 OR replace(replace(b.prosrc,'SELECT id,escrow_id,action,expected_revision','SELECT id,escrow_id,decision_row.action,expected_revision'),'FROM payment_v2.decisions WHERE id=cmd;','FROM payment_v2.decisions decision_row WHERE id=cmd;') IS DISTINCT FROM p.prosrc) THEN RAISE EXCEPTION 'decision correction exceeds alias-only scope';END IF;
END $postflight$;
COMMIT;
