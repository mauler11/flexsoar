-- DRAFT ONLY / NOT EXECUTED. Financial transitions and durable recovery; no external calls.
BEGIN;
CREATE TABLE payment_v2.claim_history(
 event_id uuid PRIMARY KEY REFERENCES payment_v2.events(id),card_id uuid NOT NULL REFERENCES public.cards(id),
 from_owner uuid NOT NULL REFERENCES public.users(id),to_owner uuid NOT NULL REFERENCES public.users(id),
 conditional boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(from_owner<>to_owner)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.claim_history FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE FUNCTION payment_v2.move_claim(p_event uuid,p_card uuid,p_from uuid,p_to uuid,p_conditional boolean) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (SELECT coalesce(sum(direction),0) FROM public.ledger_entries WHERE asset='card' AND card_id=p_card AND account_id=p_from)<>1
 OR (SELECT coalesce(sum(direction),0) FROM public.ledger_entries WHERE asset='card' AND card_id=p_card AND account_id=p_to)<>0 THEN RAISE EXCEPTION 'PAYMENT_V2_OWNERSHIP_LEDGER_CONFLICT';END IF;
 INSERT INTO public.ledger_entries(txn_id,entry_type,asset,account_id,card_id,direction)
 VALUES(p_event,'card_transfer','card',p_from,p_card,-1),(p_event,'card_transfer','card',p_to,p_card,1);
 INSERT INTO payment_v2.claim_history VALUES(p_event,p_card,p_from,p_to,p_conditional,now());
 -- Legacy provenance rows remain untouched; append-only v2 history is separate.
END $$;
CREATE FUNCTION public.fn_payment_v2_reconcile_event(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e payment_v2.events%rowtype;a payment_v2.attempts%rowtype;s payment_v2.sales%rowtype;c public.cards%rowtype;
 o public.orders%rowtype;x payment_v2.escrows%rowtype;d payment_v2.decisions%rowtype;v_result jsonb;ref text;n payment_v2.networks%rowtype;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_settler');
 SELECT id,attempt_id,sale_id,kind,network_id,genesis,signature,slot,funded_at,decision_revision,proof,proof_digest,verifier_login,created_at INTO e.id,e.attempt_id,e.sale_id,e.kind,e.network_id,e.genesis,e.signature,e.slot,e.funded_at,e.decision_revision,e.proof,e.proof_digest,e.verifier_login,e.created_at FROM payment_v2.events WHERE id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_EVENT_MISSING';END IF;
 PERFORM payment_v2.lock_sale(e.sale_id);
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=e.sale_id;
 SELECT id,idempotency_key,buyer_id,sale_id,listing_id,card_id,item_id,seller_id,network_id,quote_id,attempt_commitment,beneficiary,buyer_wallet,seller_wallet,buyer_token,seller_token,treasury_token,refund_token,policy_version,total_units,net_units,fee_units,gross_cents,fee_cents,net_cents,valid_from,expires_at,permit,authorized_by,authorized_at,state,created_at INTO a.id,a.idempotency_key,a.buyer_id,a.sale_id,a.listing_id,a.card_id,a.item_id,a.seller_id,a.network_id,a.quote_id,a.attempt_commitment,a.beneficiary,a.buyer_wallet,a.seller_wallet,a.buyer_token,a.seller_token,a.treasury_token,a.refund_token,a.policy_version,a.total_units,a.net_units,a.fee_units,a.gross_cents,a.fee_cents,a.net_cents,a.valid_from,a.expires_at,a.permit,a.authorized_by,a.authorized_at,a.state,a.created_at FROM payment_v2.attempts WHERE id=e.attempt_id FOR UPDATE;
 SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE sale_id=s.id FOR UPDATE;
 PERFORM 1 FROM payment_v2.events WHERE id=e.id FOR UPDATE;
 n:=s.network_snapshot;ref:='solv2:'||payment_v2.b58(n.genesis)||':'||e.signature;
 IF a.sale_id<>s.id OR a.listing_id<>s.listing_id OR a.card_id<>s.card_id OR a.item_id<>s.item_id OR a.seller_id<>s.seller_id OR a.network_id<>e.network_id OR e.network_id<>s.network_id OR a.permit IS NULL OR e.proof->>'permitHex'<>encode(a.permit,'hex') THEN RAISE EXCEPTION 'PAYMENT_V2_RECEIPT_CONTEXT_CONFLICT';END IF;
 SELECT id,buyer_id,seller_id,listing_id,card_id,gross_cents,payment_rail,settlement_ref INTO o.id,o.buyer_id,o.seller_id,o.listing_id,o.card_id,o.gross_cents,o.payment_rail,o.settlement_ref FROM public.orders WHERE payment_v2_attempt_id=a.id;
 IF o.id IS NOT NULL AND (o.buyer_id<>a.buyer_id OR o.seller_id<>a.seller_id OR o.listing_id<>a.listing_id OR o.card_id<>a.card_id OR o.gross_cents<>a.gross_cents OR o.payment_rail<>CASE s.mode WHEN 0 THEN 'solana_v2_escrow' ELSE 'solana_v2_direct' END) THEN RAISE EXCEPTION 'PAYMENT_V2_ORDER_CONFLICT';END IF;
 IF o.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_v2.events fe WHERE fe.attempt_id=a.id AND fe.kind IN('funded','direct') AND o.settlement_ref='solv2:'||payment_v2.b58(n.genesis)||':'||fe.signature) THEN RAISE EXCEPTION 'PAYMENT_V2_ORDER_REFERENCE_CONFLICT';END IF;
 SELECT result INTO v_result FROM payment_v2.consumptions WHERE event_id=e.id;
 IF FOUND THEN
  IF o.id IS NULL OR v_result->>'orderId'<>o.id::text OR NOT EXISTS(SELECT 1 FROM payment_v2.consumptions WHERE event_id=e.id AND order_id=o.id) THEN RAISE EXCEPTION 'PAYMENT_V2_RETURNED_ID_CONFLICT';END IF;RETURN v_result;
 END IF;
 SELECT id,item_id,owner_id,status INTO c.id,c.item_id,c.owner_id,c.status FROM public.cards WHERE id=s.card_id;
 IF s.generation<>(SELECT generation FROM payment_v2.inventory WHERE card_id=c.id) THEN RAISE EXCEPTION 'PAYMENT_V2_GENERATION_CONFLICT';END IF;
 -- Lock user rows only after Item/Card/Sale/Listing/Attempt/Escrow/Evidence.
 PERFORM 1 FROM public.users WHERE id IN(a.buyer_id,a.seller_id) ORDER BY id FOR UPDATE;
 IF e.kind IN('funded','direct') THEN
  IF o.id IS NOT NULL OR x.id IS NOT NULL OR s.state NOT IN('open','cancel_requested') OR c.owner_id<>s.seller_id OR c.status<>'active'
  OR NOT EXISTS(SELECT 1 FROM public.listings WHERE id=s.listing_id AND seller_id=s.seller_id AND card_id=c.id AND status='public') THEN RAISE EXCEPTION 'PAYMENT_V2_FUNDED_OWNERSHIP_CONFLICT: manual resolution required; never pay again';END IF;
  INSERT INTO public.orders(listing_id,card_id,buyer_id,seller_id,gross_cents,fee_bps,fee_cents,net_cents,settlement_ref,status,txn_id,credit_cents,cash_cents,seller_payout,payout_release_at,payment_rail,payment_v2_attempt_id)
  VALUES(a.listing_id,a.card_id,a.buyer_id,a.seller_id,a.gross_cents,500,a.fee_cents,a.net_cents,ref,CASE e.kind WHEN 'funded' THEN 'escrow_funded' ELSE 'settled' END,e.id,0,0,NULL,NULL,CASE s.mode WHEN 0 THEN 'solana_v2_escrow' ELSE 'solana_v2_direct' END,a.id) RETURNING id,buyer_id,seller_id,listing_id,card_id,gross_cents,payment_rail,settlement_ref INTO o.id,o.buyer_id,o.seller_id,o.listing_id,o.card_id,o.gross_cents,o.payment_rail,o.settlement_ref;
  PERFORM payment_v2.move_claim(e.id,c.id,s.seller_id,a.buyer_id,e.kind='funded');
  UPDATE public.cards SET owner_id=a.buyer_id,status=CASE e.kind WHEN 'funded' THEN 'pending_vault'::public.card_status ELSE 'active'::public.card_status END WHERE id=c.id;
  UPDATE public.listings SET status='sold',sold_at=now() WHERE id=s.listing_id;
  IF e.kind='funded' THEN
   INSERT INTO payment_v2.escrows(sale_id,attempt_id,order_id,funding_event,state,dispatch_due,review_after)
   VALUES(s.id,a.id,o.id,e.id,'funded',to_timestamp(e.funded_at)+interval '48 hours',to_timestamp(e.funded_at)+interval '72 hours') RETURNING id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication;
   INSERT INTO payment_v2.usdc_journal(event_id,network_id,mint,account,units) VALUES(e.id,s.network_id,n.mint,'wallet:'||payment_v2.b58(a.buyer_wallet),-a.total_units),(e.id,s.network_id,n.mint,'escrow:'||s.id::text,a.total_units);
  ELSE
   INSERT INTO payment_v2.usdc_journal(event_id,network_id,mint,account,units)
   SELECT e.id,s.network_id,n.mint,v.account,sum(v.units) FROM (VALUES('wallet:'||payment_v2.b58(a.buyer_wallet),-a.total_units),('wallet:'||payment_v2.b58(a.seller_wallet),a.net_units),('wallet:'||payment_v2.b58(n.treasury),a.fee_units)) v(account,units) GROUP BY v.account HAVING sum(v.units)<>0;
  END IF;
 ELSE
  IF x.id IS NULL OR x.attempt_id<>a.id OR x.order_id<>o.id OR x.state<>'funded' OR s.state<>'funded' OR c.owner_id<>a.buyer_id OR c.status<>'pending_vault' OR x.held THEN RAISE EXCEPTION 'PAYMENT_V2_TERMINAL_STATE_CONFLICT';END IF;
  SELECT d0.id,d0.escrow_id,d0.action,d0.expected_revision,d0.actor_staff,d0.person_id,d0.pair_commitment,d0.evidence_digest,d0.payload,d0.created_at INTO d.id,d.escrow_id,d.action,d.expected_revision,d.actor_staff,d.person_id,d.pair_commitment,d.evidence_digest,d.payload,d.created_at FROM payment_v2.decisions d0 JOIN payment_v2.attestations t ON t.decision_id=d0.id
  WHERE d0.escrow_id=x.id AND ((e.kind='released' AND d0.action='release') OR (e.kind='refunded' AND d0.action IN('refund','resolve_dispute_refund'))) AND t.resulting_revision=e.decision_revision;
  IF d.id IS NULL OR e.decision_revision<>x.decision_revision THEN RAISE EXCEPTION 'PAYMENT_V2_MATCHING_APPROVAL_REQUIRED';END IF;
  IF e.kind='released' THEN
   IF x.received_at IS NULL OR x.authentication<>'pass'
   OR NOT EXISTS(SELECT 1 FROM payment_v2.decisions ad JOIN payment_v2.attestations at ON at.decision_id=ad.id WHERE ad.escrow_id=x.id AND ad.action IN('authentication_pass','review_authentication_pass') AND ad.person_id<>d.person_id)
   OR EXISTS(SELECT 1 FROM payment_v2.decisions rd JOIN payment_v2.attestations rt ON rt.decision_id=rd.id WHERE rd.escrow_id=x.id AND rd.action='receipt' AND rd.person_id=d.person_id) THEN RAISE EXCEPTION 'PAYMENT_V2_ACCEPTANCE_REQUIRED';END IF;
   INSERT INTO payment_v2.usdc_journal(event_id,network_id,mint,account,units)
   SELECT e.id,s.network_id,n.mint,v.account,sum(v.units) FROM (VALUES('escrow:'||s.id::text,-a.total_units),('wallet:'||payment_v2.b58(a.seller_wallet),a.net_units),('wallet:'||payment_v2.b58(n.treasury),a.fee_units)) v(account,units) GROUP BY v.account HAVING sum(v.units)<>0;
   UPDATE public.orders SET status='settled' WHERE id=o.id;
   UPDATE public.items SET custody='warehouse',custody_holder_id=NULL,status='minted',authenticated_at=(SELECT to_timestamp((at.proof->>'executedAtSeconds')::bigint) FROM payment_v2.decisions ad JOIN payment_v2.attestations at ON at.decision_id=ad.id WHERE ad.escrow_id=x.id AND ad.action IN('authentication_pass','review_authentication_pass') LIMIT 1),
    authenticated_by=(SELECT st.user_id FROM payment_v2.decisions ad JOIN payment_v2.staff st ON st.id=ad.actor_staff JOIN payment_v2.attestations at ON at.decision_id=ad.id WHERE ad.escrow_id=x.id AND ad.action IN('authentication_pass','review_authentication_pass') LIMIT 1) WHERE id=a.item_id;
   UPDATE public.cards SET status='active' WHERE id=c.id;
  ELSE
   INSERT INTO payment_v2.usdc_journal(event_id,network_id,mint,account,units) VALUES(e.id,s.network_id,n.mint,'escrow:'||s.id::text,-a.total_units),(e.id,s.network_id,n.mint,'wallet:'||payment_v2.b58(a.buyer_wallet),a.total_units);
   PERFORM payment_v2.move_claim(e.id,c.id,a.buyer_id,a.seller_id,false);
   UPDATE public.cards SET owner_id=a.seller_id,status='locked' WHERE id=c.id;
   UPDATE public.orders SET status='refunded' WHERE id=o.id;
   UPDATE payment_v2.inventory SET quarantined=true WHERE card_id=c.id;
   -- No physical-return assertion, seller ban, new Card or automatic relist.
  END IF;
  UPDATE payment_v2.escrows SET state=e.kind,terminal_event=e.id WHERE id=x.id;
 END IF;
 UPDATE payment_v2.attempts SET state=e.kind WHERE id=a.id;
 UPDATE payment_v2.sales SET state=e.kind WHERE id=s.id;
 UPDATE payment_v2.operations SET state='observed',resolved_event=e.id,lease_until=NULL,last_error='No command execution inferred; superseded/resolved by finalized '||e.kind||':'||e.id::text WHERE sale_id=s.id AND state<>'observed' AND (e.kind IN('direct','released','refunded') OR action='revoke_sale');
 IF e.kind IN('direct','released','refunded') THEN
  PERFORM payment_v2.enqueue(s.id,'acknowledge_claim',jsonb_build_object('saleId',s.id,'eventId',e.id,'orderId',o.id),e.decision_revision);
 END IF;
 v_result:=jsonb_build_object('orderId',o.id,'attemptId',a.id,'saleId',s.id,'eventId',e.id,'kind',e.kind);
 INSERT INTO payment_v2.consumptions VALUES(e.id,o.id,v_result,now(),session_user);
 INSERT INTO payment_v2.outbox(event_id,user_id,kind,payload)
 VALUES(e.id,a.buyer_id,'payment_v2_'||e.kind,v_result),(e.id,a.seller_id,'payment_v2_'||e.kind,v_result);
 RETURN v_result;
END $$;
CREATE FUNCTION public.fn_payment_v2_record_decision(p_decision jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=payment_v2.actor();x payment_v2.escrows%rowtype;s payment_v2.sales%rowtype;st payment_v2.staff%rowtype;d payment_v2.decisions%rowtype;
 action text:=p_decision->>'action';cmd uuid:=(p_decision->>'commandId')::uuid;required_role text;v_op uuid;v_person uuid;
BEGIN
 required_role:=CASE action WHEN 'receipt' THEN 'receiver' WHEN 'authentication_pass' THEN 'authenticator' WHEN 'authentication_fail' THEN 'authenticator' WHEN 'release' THEN 'release' WHEN 'refund' THEN 'governor' WHEN 'dispute' THEN 'guardian' WHEN 'review_authentication_pass' THEN 'reviewer' WHEN 'review_authentication_fail' THEN 'reviewer' WHEN 'resolve_dispute_release' THEN 'governor' WHEN 'resolve_dispute_refund' THEN 'governor' END;
 SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE user_id=u AND role=required_role AND active;
 IF st.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_STAFF_ROLE_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=(p_decision->>'escrowId')::uuid;PERFORM payment_v2.lock_sale(x.sale_id);
 SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=x.id FOR UPDATE;SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=x.sale_id;
 SELECT id,escrow_id,action,expected_revision,actor_staff,person_id,pair_commitment,evidence_digest,payload,created_at INTO d.id,d.escrow_id,d.action,d.expected_revision,d.actor_staff,d.person_id,d.pair_commitment,d.evidence_digest,d.payload,d.created_at FROM payment_v2.decisions WHERE id=cmd;
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
CREATE FUNCTION public.fn_payment_v2_approve_refund(p_command_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE st payment_v2.staff%rowtype;d payment_v2.decisions%rowtype;x payment_v2.escrows%rowtype;v uuid;
BEGIN
 SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE user_id=payment_v2.actor() AND role='governor' AND active;
 IF st.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNOR_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT id,escrow_id,action,expected_revision,actor_staff,person_id,pair_commitment,evidence_digest,payload,created_at INTO d.id,d.escrow_id,d.action,d.expected_revision,d.actor_staff,d.person_id,d.pair_commitment,d.evidence_digest,d.payload,d.created_at FROM payment_v2.decisions WHERE id=p_command_id;SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=d.escrow_id;
 PERFORM payment_v2.lock_sale(x.sale_id);SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=x.id FOR UPDATE;
 IF d.id IS NOT NULL AND EXISTS(SELECT 1 FROM payment_v2.governance_approvals WHERE decision_id=d.id AND person_id=st.person_id) THEN SELECT id INTO v FROM payment_v2.operations WHERE decision_id=d.id;RETURN v;END IF;
 IF d.id IS NULL OR x.id IS NULL OR d.action NOT IN('refund','resolve_dispute_release','resolve_dispute_refund') OR x.state<>'funded' OR (x.held AND d.action='refund') OR x.decision_revision<>d.expected_revision THEN RAISE EXCEPTION 'PAYMENT_V2_STALE_REFUND';END IF;
 IF (SELECT count(DISTINCT person_id) FROM payment_v2.staff WHERE role='governor' AND active)<>3 THEN RAISE EXCEPTION 'PAYMENT_V2_THREE_GOVERNORS_REQUIRED';END IF;
 INSERT INTO payment_v2.governance_approvals VALUES(d.id,st.id,st.person_id) ON CONFLICT DO NOTHING;
 IF (SELECT count(DISTINCT person_id) FROM payment_v2.governance_approvals WHERE decision_id=d.id)>=2 THEN UPDATE payment_v2.operations SET ready=true WHERE decision_id=d.id;END IF;
 SELECT id INTO v FROM payment_v2.operations WHERE decision_id=d.id;RETURN v;
END $$;
CREATE FUNCTION public.fn_payment_v2_record_attestation(p_proof jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d payment_v2.decisions%rowtype;x payment_v2.escrows%rowtype;s payment_v2.sales%rowtype;old payment_v2.attestations%rowtype;r numeric;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 SELECT id,escrow_id,action,expected_revision,actor_staff,person_id,pair_commitment,evidence_digest,payload,created_at INTO d.id,d.escrow_id,d.action,d.expected_revision,d.actor_staff,d.person_id,d.pair_commitment,d.evidence_digest,d.payload,d.created_at FROM payment_v2.decisions WHERE id=(p_proof->>'commandId')::uuid;SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=d.escrow_id;
 PERFORM payment_v2.lock_sale(x.sale_id);SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=x.id FOR UPDATE;SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=x.sale_id;
 SELECT decision_id,signature,slot,resulting_revision,proof,verifier_login,created_at INTO old.decision_id,old.signature,old.slot,old.resulting_revision,old.proof,old.verifier_login,old.created_at FROM payment_v2.attestations WHERE decision_id=d.id;
 IF FOUND THEN IF old.proof IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'PAYMENT_V2_ATTESTATION_CONFLICT';END IF;RETURN;END IF;
 PERFORM payment_v2.proof_shape(p_proof);
 IF NOT (p_proof ?& ARRAY['commandId','finality','sale','genesis','program','action','evidenceDigest','pairCommitment','signature','slot','executedAtSeconds','resultingRevision','actor']) OR d.id IS NULL OR p_proof->>'finality' IS DISTINCT FROM 'finalized' OR payment_v2.unb58(p_proof->>'sale') IS DISTINCT FROM s.sale_address
 OR payment_v2.unb58(p_proof->>'genesis') IS DISTINCT FROM (s.network_snapshot).genesis OR payment_v2.unb58(p_proof->>'program') IS DISTINCT FROM (s.network_snapshot).program
 OR payment_v2.unb58(p_proof->>'actor') IS DISTINCT FROM (SELECT public_key FROM payment_v2.staff WHERE id=d.actor_staff) OR p_proof->>'action' IS DISTINCT FROM d.action OR decode(p_proof->>'evidenceDigest','hex') IS DISTINCT FROM d.evidence_digest
 OR decode(p_proof->>'pairCommitment','hex') IS DISTINCT FROM d.pair_commitment OR x.state<>'funded' OR x.decision_revision<>d.expected_revision THEN RAISE EXCEPTION 'PAYMENT_V2_ATTESTATION_CONTEXT';END IF;
 r:=d.expected_revision+CASE WHEN d.action IN('release','refund','dispute','resolve_dispute_release','resolve_dispute_refund') THEN 1 ELSE 0 END;
 IF (p_proof->>'resultingRevision') IS NULL OR r<>(p_proof->>'resultingRevision')::numeric THEN RAISE EXCEPTION 'PAYMENT_V2_ATTESTATION_REVISION';END IF;
 IF d.action IN('refund','resolve_dispute_release','resolve_dispute_refund') AND (SELECT count(DISTINCT person_id) FROM payment_v2.governance_approvals WHERE decision_id=d.id)<2 THEN RAISE EXCEPTION 'PAYMENT_V2_TWO_GOVERNORS_REQUIRED';END IF;
 INSERT INTO payment_v2.attestations VALUES(d.id,p_proof->>'signature',(p_proof->>'slot')::bigint,r,p_proof,session_user,now());
 UPDATE payment_v2.escrows SET decision_revision=r,received_at=CASE WHEN d.action='receipt' THEN to_timestamp((p_proof->>'executedAtSeconds')::bigint) ELSE received_at END,
 authentication=CASE d.action WHEN 'authentication_pass' THEN 'pass' WHEN 'authentication_fail' THEN 'fail' WHEN 'review_authentication_pass' THEN 'pass' WHEN 'review_authentication_fail' THEN 'fail' ELSE authentication END,
 held=CASE WHEN d.action LIKE 'resolve_dispute_%' THEN false ELSE held OR d.action='dispute' END WHERE id=x.id;
 IF d.action='receipt' THEN UPDATE public.items SET custody='warehouse',custody_holder_id=NULL WHERE id=s.item_id;END IF;
 UPDATE payment_v2.operations SET state='observed',lease_until=NULL WHERE decision_id=d.id;
 IF d.action IN('release','refund','resolve_dispute_refund') THEN
  PERFORM payment_v2.enqueue(s.id,'execute_outcome',jsonb_build_object('saleId',s.id,'decisionId',d.id,'expectedRevision',r::text),r);
 END IF;
 -- A chain release/refund AUTHORIZATION is not a financial outcome or Card unlock.
END $$;
CREATE FUNCTION public.fn_payment_v2_record_lifecycle(p_proof jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s payment_v2.sales%rowtype;old payment_v2.lifecycle_evidence%rowtype;k text:=p_proof->>'kind';
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=(p_proof->>'saleId')::uuid;PERFORM payment_v2.lock_sale(s.id);SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=s.id;
 SELECT id,sale_id,kind,proof,signature,created_at INTO old.id,old.sale_id,old.kind,old.proof,old.signature,old.created_at FROM payment_v2.lifecycle_evidence WHERE sale_id=s.id AND kind=k;
 IF FOUND THEN IF old.proof IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'PAYMENT_V2_LIFECYCLE_CONFLICT';END IF;RETURN;END IF;
 PERFORM payment_v2.proof_shape(p_proof);
 IF NOT (p_proof ?& ARRAY['saleId','finality','sale','genesis','program','generation','revision','signature','kind']) OR s.id IS NULL OR p_proof->>'finality' IS DISTINCT FROM 'finalized' OR payment_v2.unb58(p_proof->>'sale') IS DISTINCT FROM s.sale_address
 OR payment_v2.unb58(p_proof->>'genesis') IS DISTINCT FROM (s.network_snapshot).genesis OR payment_v2.unb58(p_proof->>'program') IS DISTINCT FROM (s.network_snapshot).program
 OR (p_proof->>'generation')::numeric<>s.generation OR (p_proof->>'revision')::numeric<>s.revision THEN RAISE EXCEPTION 'PAYMENT_V2_LIFECYCLE_CONTEXT';END IF;
 IF k='opened' THEN
  IF s.state NOT IN('opening','cancel_requested') THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_OPENING';END IF;UPDATE payment_v2.sales SET state=CASE WHEN state='cancel_requested' THEN state ELSE 'open' END WHERE id=s.id;
 ELSIF k='revoked' THEN
  IF s.state NOT IN('open','cancel_requested') OR EXISTS(SELECT 1 FROM payment_v2.events WHERE sale_id=s.id AND kind IN('funded','direct')) THEN RAISE EXCEPTION 'PAYMENT_V2_CONSUMED_SALE_CANNOT_REVOKE';END IF;
  UPDATE payment_v2.sales SET state='revoked',fence=false WHERE id=s.id;UPDATE public.listings SET status='cancelled' WHERE id=s.listing_id;
 ELSIF k='acknowledged' THEN
  IF p_proof->>'outcome' IS DISTINCT FROM s.state OR decode(p_proof->>'cardCommitment','hex') IS DISTINCT FROM (SELECT card_commitment FROM payment_v2.inventory WHERE card_id=s.card_id) THEN RAISE EXCEPTION 'PAYMENT_V2_ACK_CONTEXT';END IF;
  IF s.state NOT IN('direct','released','refunded') OR NOT EXISTS(SELECT 1 FROM payment_v2.events e JOIN payment_v2.consumptions c ON c.event_id=e.id WHERE e.sale_id=s.id AND e.kind=s.state) THEN RAISE EXCEPTION 'PAYMENT_V2_DATABASE_COMMIT_REQUIRED';END IF;
  UPDATE payment_v2.sales SET chain_acknowledged=true,fence=false WHERE id=s.id;
  UPDATE payment_v2.inventory SET mode=CASE WHEN s.state='refunded' THEN mode ELSE 1 END,custody_version=custody_version+CASE WHEN s.state='refunded' THEN 0 ELSE 1 END WHERE card_id=s.card_id;
 ELSE RAISE EXCEPTION 'PAYMENT_V2_UNSUPPORTED_LIFECYCLE';END IF;
 INSERT INTO payment_v2.lifecycle_evidence(sale_id,kind,proof,signature) VALUES(s.id,k,p_proof,p_proof->>'signature');
 UPDATE payment_v2.operations SET state='observed',lease_until=NULL WHERE sale_id=s.id AND action=CASE k WHEN 'opened' THEN 'open_sale' WHEN 'revoked' THEN 'revoke_sale' ELSE 'acknowledge_claim' END;
END $$;
CREATE FUNCTION public.fn_payment_v2_admin_queue() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_v2.staff WHERE user_id=payment_v2.actor() AND active) THEN RAISE EXCEPTION 'PAYMENT_V2_STAFF_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('escrowId',id,'saleId',sale_id,'state',state,'held',held,'authentication',authentication,'receivedAt',received_at,'dispatchEvidence',dispatch_evidence,'dispatchDue',dispatch_due,'reviewAfter',review_after,'revision',decision_revision::text)) FROM payment_v2.escrows WHERE state='funded'),'[]'::jsonb);
END $$;
CREATE FUNCTION public.fn_payment_v2_admin_obligations() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_v2.staff WHERE user_id=payment_v2.actor() AND active) THEN RAISE EXCEPTION 'PAYMENT_V2_STAFF_REQUIRED' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('escrows',public.fn_payment_v2_admin_queue(),
 'operations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'saleId',o.sale_id,'action',o.action,'state',o.state,'signature',o.signature,'attempts',o.attempts,'lastError',o.last_error)) FROM payment_v2.operations o WHERE state<>'observed'),'[]'::jsonb),
 'unresolved',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'networkId',u.network_id,'sale',u.sale_address,'error',u.error,'createdAt',u.created_at)) FROM payment_v2.unresolved u),'[]'::jsonb));
END $$;
DO $seal$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'fn_payment_v2_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);END LOOP;END $seal$;
COMMIT;
