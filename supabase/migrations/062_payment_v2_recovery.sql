-- DRAFT ONLY / NOT EXECUTED. Durable work; no signing, HTTP, SQL scheduling or refunds by timer.
BEGIN;
CREATE FUNCTION public.fn_payment_v2_begin_scan(p_genesis text,p_program text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n uuid;c payment_v2.cursors%rowtype;v uuid:=gen_random_uuid();
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'PAYMENT_V2_SCAN_LIMIT';END IF;
 SELECT id INTO n FROM payment_v2.networks WHERE genesis=payment_v2.unb58(p_genesis) AND program=payment_v2.unb58(p_program);
 IF n IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_NETWORK_UNKNOWN';END IF;
 INSERT INTO payment_v2.cursors(network_id) VALUES(n) ON CONFLICT DO NOTHING;
 SELECT network_id,after_address,lease_id,leased_by,lease_until,batch_limit,updated_at INTO c.network_id,c.after_address,c.lease_id,c.leased_by,c.lease_until,c.batch_limit,c.updated_at FROM payment_v2.cursors WHERE network_id=n FOR UPDATE;
 IF c.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'PAYMENT_V2_SCAN_BUSY';END IF;
 UPDATE payment_v2.cursors SET lease_id=v,leased_by=session_user,lease_until=clock_timestamp()+interval '5 minutes',batch_limit=p_limit WHERE network_id=n;
 RETURN jsonb_build_object('leaseId',v,'afterAddress',c.after_address);
END $$;
CREATE FUNCTION public.fn_payment_v2_finish_scan(p_lease_id uuid,p_last_address text,p_failures jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c payment_v2.cursors%rowtype;f jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 SELECT network_id,after_address,lease_id,leased_by,lease_until,batch_limit,updated_at INTO c.network_id,c.after_address,c.lease_id,c.leased_by,c.lease_until,c.batch_limit,c.updated_at FROM payment_v2.cursors WHERE lease_id=p_lease_id FOR UPDATE;
 IF c.network_id IS NULL OR c.leased_by<>session_user OR c.lease_until IS NULL OR c.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'PAYMENT_V2_SCAN_LEASE_LOST';END IF;
 IF p_last_address IS NOT NULL THEN PERFORM payment_v2.unb58(p_last_address);END IF;
 IF jsonb_typeof(p_failures) IS DISTINCT FROM 'array' OR jsonb_array_length(p_failures)>c.batch_limit THEN RAISE EXCEPTION 'PAYMENT_V2_SCAN_FAILURES';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_failures) LOOP
  PERFORM payment_v2.unb58(f->>'sale');
  INSERT INTO payment_v2.unresolved(network_id,sale_address,error) VALUES(c.network_id,f->>'sale',left(f->>'error',2000));
 END LOOP;
 UPDATE payment_v2.cursors SET after_address=p_last_address,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE network_id=c.network_id;
END $$;
CREATE FUNCTION public.fn_payment_v2_claim_operations(p_worker_id uuid,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o payment_v2.operations%rowtype;v uuid;r jsonb:='[]'::jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_executor');
 IF p_worker_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'PAYMENT_V2_WORK_LIMIT';END IF;
 FOR o IN SELECT op.id,op.command_id,op.decision_id,op.sale_id,op.action,op.payload,op.payload_digest,op.expected_revision,op.ready,op.state,op.lease_id,op.leased_by,op.worker_id,op.lease_until,op.attempts,op.signature,op.resolved_event,op.last_error,op.available_at,op.created_at FROM payment_v2.operations op WHERE ready AND state<>'observed' AND available_at<=clock_timestamp()
 AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit LOOP
  v:=gen_random_uuid();
  UPDATE payment_v2.operations SET lease_id=v,leased_by=session_user,worker_id=p_worker_id,lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,
   state=CASE WHEN state='pending' THEN 'leased' ELSE state END WHERE id=o.id;
  r:=r||jsonb_build_array(jsonb_build_object('id',o.id,'leaseId',v,'payloadDigest',encode(o.payload_digest,'hex'),'expectedRevision',o.expected_revision::text,'action',o.action,'payload',o.payload,'signature',o.signature,'recoveryOnly',o.state IN('submitted','unknown')));
 END LOOP;RETURN r;
END $$;
CREATE FUNCTION public.fn_payment_v2_finish_operation(p_operation_id uuid,p_lease_id uuid,p_outcome text,p_signature text,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o payment_v2.operations%rowtype;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_executor');
 SELECT id,command_id,decision_id,sale_id,action,payload,payload_digest,expected_revision,ready,state,lease_id,leased_by,worker_id,lease_until,attempts,signature,resolved_event,last_error,available_at,created_at INTO o.id,o.command_id,o.decision_id,o.sale_id,o.action,o.payload,o.payload_digest,o.expected_revision,o.ready,o.state,o.lease_id,o.leased_by,o.worker_id,o.lease_until,o.attempts,o.signature,o.resolved_event,o.last_error,o.available_at,o.created_at FROM payment_v2.operations WHERE id=p_operation_id FOR UPDATE;
 IF o.id IS NOT NULL AND o.lease_id=p_lease_id AND o.leased_by=session_user AND o.lease_until IS NULL AND o.state=p_outcome AND o.signature IS NOT DISTINCT FROM p_signature AND p_outcome IN('submitted','unknown') AND EXISTS(SELECT 1 FROM payment_v2.signed_operations WHERE operation_id=o.id AND signature=p_signature) THEN RETURN;END IF;
 IF o.id IS NULL OR o.lease_id IS DISTINCT FROM p_lease_id OR o.leased_by<>session_user OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR o.state='observed' THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_LEASE_LOST';END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN('retry','submitted','unknown') OR (p_signature IS NOT NULL AND p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{80,96}$') THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_OUTCOME';END IF;
 IF o.signature IS NOT NULL AND p_signature IS DISTINCT FROM o.signature THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_SIGNATURE_CONFLICT';END IF;
 IF p_outcome='retry' AND (p_signature IS NOT NULL OR o.signature IS NOT NULL OR o.state IN('submitted','unknown')) THEN RAISE EXCEPTION 'PAYMENT_V2_SENT_OPERATION_RECOVERY_ONLY';END IF;
 IF p_outcome IN('submitted','unknown') AND NOT EXISTS(SELECT 1 FROM payment_v2.signed_operations WHERE operation_id=o.id AND signature=p_signature) THEN RAISE EXCEPTION 'PAYMENT_V2_DURABLE_SIGNED_BYTES_REQUIRED';END IF;
 IF p_outcome IN('submitted','unknown') AND coalesce(o.signature,p_signature) IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_PERSIST_SIGNED_SIGNATURE_BEFORE_SEND';END IF;
 UPDATE payment_v2.operations SET state=CASE p_outcome WHEN 'retry' THEN 'pending' ELSE p_outcome END,signature=coalesce(signature,p_signature),
 last_error=left(p_error,2000),available_at=clock_timestamp()+interval '30 seconds',lease_until=NULL WHERE id=o.id;
 -- submitted means signed identity persisted BEFORE network send; only a verifier may mark observed.
END $$;
CREATE FUNCTION public.fn_payment_v2_operation_context(p_operation_id uuid,p_lease_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o payment_v2.operations%rowtype;s payment_v2.sales%rowtype;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_executor');
 SELECT id,command_id,decision_id,sale_id,action,payload,payload_digest,expected_revision,ready,state,lease_id,leased_by,worker_id,lease_until,attempts,signature,resolved_event,last_error,available_at,created_at INTO o.id,o.command_id,o.decision_id,o.sale_id,o.action,o.payload,o.payload_digest,o.expected_revision,o.ready,o.state,o.lease_id,o.leased_by,o.worker_id,o.lease_until,o.attempts,o.signature,o.resolved_event,o.last_error,o.available_at,o.created_at FROM payment_v2.operations WHERE id=p_operation_id;
 IF o.id IS NULL OR o.lease_id IS DISTINCT FROM p_lease_id OR o.leased_by<>session_user OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_LEASE_LOST';END IF;
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=o.sale_id;
 RETURN jsonb_build_object('operation',to_jsonb(o),'sale',to_jsonb(s),
 'inventory',(SELECT to_jsonb(v) FROM payment_v2.inventory v WHERE card_id=s.card_id),
 'attempts',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM payment_v2.attempts a WHERE sale_id=s.id),'[]'::jsonb),
 'decisions',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM payment_v2.decisions d JOIN payment_v2.escrows x ON x.id=d.escrow_id WHERE x.sale_id=s.id),'[]'::jsonb));
END $$;
CREATE FUNCTION public.fn_payment_v2_claim_outbox(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o payment_v2.outbox%rowtype;v uuid;r jsonb:='[]'::jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_notifier');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'PAYMENT_V2_WORK_LIMIT';END IF;
 FOR o IN SELECT ob.id,ob.event_id,ob.user_id,ob.kind,ob.payload,ob.state,ob.lease_id,ob.leased_by,ob.lease_until,ob.attempts,ob.available_at,ob.delivered_at,ob.last_error FROM payment_v2.outbox ob WHERE state<>'delivered' AND available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT p_limit LOOP
  v:=gen_random_uuid();UPDATE payment_v2.outbox SET lease_id=v,leased_by=session_user,lease_until=clock_timestamp()+interval '5 minutes',state='leased',attempts=attempts+1 WHERE id=o.id;
  r:=r||jsonb_build_array(jsonb_build_object('id',o.id,'leaseId',v,'userId',o.user_id,'kind',o.kind,'payload',o.payload,'deliveryKey',o.id));
 END LOOP;RETURN r;
END $$;
CREATE FUNCTION public.fn_payment_v2_finish_outbox(p_id uuid,p_lease_id uuid,p_delivered boolean,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o payment_v2.outbox%rowtype;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_notifier');SELECT id,event_id,user_id,kind,payload,state,lease_id,leased_by,lease_until,attempts,available_at,delivered_at,last_error INTO o.id,o.event_id,o.user_id,o.kind,o.payload,o.state,o.lease_id,o.leased_by,o.lease_until,o.attempts,o.available_at,o.delivered_at,o.last_error FROM payment_v2.outbox WHERE id=p_id FOR UPDATE;
 IF o.id IS NULL OR o.lease_id IS DISTINCT FROM p_lease_id OR o.leased_by<>session_user OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR o.state<>'leased' OR p_delivered IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_OUTBOX_LEASE_LOST';END IF;
 UPDATE payment_v2.outbox SET state=CASE WHEN p_delivered THEN 'delivered' ELSE 'pending' END,delivered_at=CASE WHEN p_delivered THEN now() END,
 last_error=left(p_error,2000),lease_until=NULL,available_at=clock_timestamp()+interval '1 minute' WHERE id=o.id;
END $$;
CREATE TABLE payment_v2.operation_failures(
 operation_id uuid PRIMARY KEY REFERENCES payment_v2.operations(id),proof jsonb NOT NULL,verifier_login name NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.operation_failures FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE FUNCTION public.fn_payment_v2_record_operation_failure(p_operation_id uuid,p_proof jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o payment_v2.operations%rowtype;s payment_v2.sales%rowtype;old jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 SELECT sale_id INTO o.sale_id FROM payment_v2.operations WHERE id=p_operation_id;PERFORM payment_v2.lock_sale(o.sale_id);
 SELECT id,sale_id,signature INTO o.id,o.sale_id,o.signature FROM payment_v2.operations WHERE id=p_operation_id FOR UPDATE;
 SELECT network_snapshot INTO s.network_snapshot FROM payment_v2.sales WHERE id=o.sale_id;
 SELECT proof INTO old FROM payment_v2.operation_failures WHERE operation_id=o.id;
 IF FOUND THEN IF old IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_FAILURE_CONFLICT';END IF;RETURN;END IF;
 PERFORM payment_v2.proof_shape(p_proof);
 IF o.id IS NULL OR o.signature IS NULL OR p_proof->>'signature' IS DISTINCT FROM o.signature OR p_proof->>'finality' IS DISTINCT FROM 'finalized' OR p_proof->'transactionError' IS NULL OR p_proof->'transactionError'='null'::jsonb
 OR payment_v2.unb58(p_proof->>'genesis') IS DISTINCT FROM (s.network_snapshot).genesis OR payment_v2.unb58(p_proof->>'program') IS DISTINCT FROM (s.network_snapshot).program THEN RAISE EXCEPTION 'PAYMENT_V2_FINALIZED_FAILURE_PROOF_REQUIRED';END IF;
 INSERT INTO payment_v2.operation_failures VALUES(o.id,p_proof,session_user,now());
 UPDATE payment_v2.operations SET state='observed',lease_until=NULL,last_error='Finalized transaction failed; no financial outcome inferred' WHERE id=o.id;
 -- A finalized failed transaction does not mark a purchase unpaid, reverse a payment or authorize a replacement send.
END $$;
CREATE FUNCTION public.fn_payment_v2_list_card(p_card_id uuid,p_seller_id uuid,p_price_cents integer,p_payout_method text,p_fair_price_cents integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.cards%rowtype;v payment_v2.inventory%rowtype;r uuid;
BEGIN
 IF payment_v2.actor() IS DISTINCT FROM p_seller_id THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_OWNER' USING ERRCODE='42501';END IF;
 PERFORM payment_v2.lock_card(p_card_id);SELECT id,item_id,owner_id,status INTO c.id,c.item_id,c.owner_id,c.status FROM public.cards WHERE id=p_card_id;SELECT card_id,item_id,card_commitment,pair_commitment,custody_version,generation,mode,quarantined,enrollment_evidence,enrolled_by,approved_by INTO v.card_id,v.item_id,v.card_commitment,v.pair_commitment,v.custody_version,v.generation,v.mode,v.quarantined,v.enrollment_evidence,v.enrolled_by,v.approved_by FROM payment_v2.inventory WHERE card_id=p_card_id;
 IF NOT payment_v2.owns_claim(c.id,p_seller_id) OR v.card_id IS NULL OR v.quarantined OR c.owner_id<>p_seller_id OR c.status<>'active' OR EXISTS(SELECT 1 FROM payment_v2.sales WHERE card_id=c.id AND fence)
 OR p_price_cents IS NULL OR p_price_cents<=0 OR p_payout_method IS DISTINCT FROM 'cash' THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_UNAVAILABLE';END IF;
 INSERT INTO public.listings(card_id,seller_id,price_cents,status,payout_method,fair_price_cents) VALUES(c.id,p_seller_id,p_price_cents,'public','cash',p_fair_price_cents) RETURNING id INTO r;RETURN r;
END $$;
CREATE FUNCTION public.fn_payment_v2_request_cancel(p_listing_id uuid,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public.listings%rowtype;s payment_v2.sales%rowtype;
BEGIN
 IF payment_v2.actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_OWNER' USING ERRCODE='42501';END IF;
 SELECT id,card_id,seller_id,price_cents,status INTO l.id,l.card_id,l.seller_id,l.price_cents,l.status FROM public.listings WHERE id=p_listing_id;PERFORM payment_v2.lock_card(l.card_id);
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE listing_id=l.id AND fence FOR UPDATE;SELECT id,card_id,seller_id,price_cents,status INTO l.id,l.card_id,l.seller_id,l.price_cents,l.status FROM public.listings WHERE id=l.id FOR UPDATE;
 IF l.id IS NULL OR l.seller_id<>p_actor THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_OWNER';END IF;
 IF s.state='cancel_requested' THEN RETURN;END IF;
 IF s.id IS NULL THEN
  IF l.status<>'public' THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_CANCELLABLE';END IF;
  UPDATE public.listings SET status='cancelled' WHERE id=l.id;RETURN;
 END IF;
 IF s.state NOT IN('opening','open') THEN RAISE EXCEPTION 'PAYMENT_V2_FUNDED_REQUIRES_MANUAL_REFUND_REVIEW';END IF;
 UPDATE payment_v2.sales SET state='cancel_requested' WHERE id=s.id;
 PERFORM payment_v2.enqueue(s.id,'revoke_sale',jsonb_build_object('saleId',s.id),s.revision);
 -- Do not cancel the listing until finalized chain revocation; a winning payment still reconciles.
END $$;
CREATE FUNCTION public.fn_payment_v2_redeem_card(p_card_id uuid,p_user_id uuid,p_address jsonb,p_fee_cents bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF payment_v2.actor() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_OWNER' USING ERRCODE='42501';END IF;
 PERFORM payment_v2.lock_card(p_card_id);
 RAISE EXCEPTION 'PAYMENT_V2_REDEMPTION_UNAVAILABLE: shipping payment proof and CardControl retirement contract required';
END $$;
CREATE TABLE payment_v2.dispatch_reviews(
 id uuid PRIMARY KEY,escrow_id uuid NOT NULL REFERENCES payment_v2.escrows(id),staff_id uuid NOT NULL REFERENCES payment_v2.staff(id),
 evidence_kind text NOT NULL CHECK(evidence_kind IN('carrier_accepted','reviewed_dropoff')),evidence_digest payment_v2.key32 NOT NULL,
 route text NOT NULL CHECK(route IN('peninsular','east_malaysia')),accepted_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.dispatch_reviews FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE FUNCTION public.fn_payment_v2_review_dispatch(p_id uuid,p_escrow_id uuid,p_kind text,p_digest text,p_route text,p_accepted_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x payment_v2.escrows%rowtype;st uuid;old payment_v2.dispatch_reviews%rowtype;
BEGIN
 SELECT id INTO st FROM payment_v2.staff WHERE user_id=payment_v2.actor() AND active AND role='reviewer';
 IF st IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_REVIEWER_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=p_escrow_id;PERFORM payment_v2.lock_sale(x.sale_id);SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=p_escrow_id FOR UPDATE;
 SELECT id,escrow_id,staff_id,evidence_kind,evidence_digest,route,accepted_at,created_at INTO old.id,old.escrow_id,old.staff_id,old.evidence_kind,old.evidence_digest,old.route,old.accepted_at,old.created_at FROM payment_v2.dispatch_reviews WHERE id=p_id;
 IF FOUND THEN IF old.escrow_id<>p_escrow_id OR old.staff_id<>st OR old.evidence_kind<>p_kind OR old.evidence_digest IS DISTINCT FROM decode(p_digest,'hex') OR old.route<>p_route OR old.accepted_at IS DISTINCT FROM p_accepted_at THEN RAISE EXCEPTION 'PAYMENT_V2_DISPATCH_REUSE';END IF;RETURN;END IF;
 IF x.id IS NULL OR x.state<>'funded' OR p_accepted_at IS NULL OR p_accepted_at>clock_timestamp() THEN RAISE EXCEPTION 'PAYMENT_V2_DISPATCH_CONTEXT';END IF;
 INSERT INTO payment_v2.dispatch_reviews VALUES(p_id,x.id,st,p_kind,decode(p_digest,'hex'),p_route,p_accepted_at,now());
 UPDATE payment_v2.escrows SET dispatch_evidence=p_kind,review_after=p_accepted_at+CASE p_route WHEN 'east_malaysia' THEN interval '14 days' ELSE interval '7 days' END WHERE id=x.id;
 -- Review triggers ONLY. No timeout refund/default. Label creation is not dispatch evidence.
END $$;
CREATE FUNCTION public.fn_payment_v2_worker_identity(p_required_role name) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_required_role IS NULL OR p_required_role NOT IN('payment_v2_issuer','payment_v2_verifier','payment_v2_settler','payment_v2_executor','payment_v2_notifier') OR (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) THEN RAISE EXCEPTION 'PAYMENT_V2_DEDICATED_CONNECTION_REQUIRED';END IF;
 PERFORM payment_v2.require_role(p_required_role);
 RETURN jsonb_build_object('login',session_user,'role',p_required_role,'superuser',false);
END $$;
CREATE FUNCTION payment_v2.exit_plan(p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE op payment_v2.operations%rowtype;s payment_v2.sales%rowtype;a payment_v2.attempts%rowtype;n payment_v2.networks%rowtype;accounts jsonb;
BEGIN
 SELECT sale_id,action,payload_digest,expected_revision INTO op.sale_id,op.action,op.payload_digest,op.expected_revision FROM payment_v2.operations WHERE id=p_operation;
 IF op.action IS DISTINCT FROM 'execute_outcome' THEN RAISE EXCEPTION 'PAYMENT_V2_SIGNED_RECOVERY_ACTION_UNSUPPORTED';END IF;
 SELECT network_id,network_snapshot,sale_address,escrow_address INTO s.network_id,s.network_snapshot,s.sale_address,s.escrow_address FROM payment_v2.sales WHERE id=op.sale_id;n:=s.network_snapshot;
 SELECT a0.seller_token,a0.treasury_token,a0.refund_token INTO a.seller_token,a.treasury_token,a.refund_token FROM payment_v2.attempts a0 JOIN payment_v2.escrows x ON x.attempt_id=a0.id WHERE x.sale_id=op.sale_id;
 IF a.seller_token IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_FUNDED_ATTEMPT_REQUIRED';END IF;
 SELECT jsonb_agg(jsonb_build_object('pubkey',v.key,'isSigner',false,'isWritable',v.writable) ORDER BY v.pos) INTO accounts
 FROM (VALUES(1,payment_v2.b58(n.config),true),(2,payment_v2.b58(s.sale_address),true),(3,payment_v2.b58(s.escrow_address),true),
 (4,payment_v2.b58(a.seller_token),true),(5,payment_v2.b58(a.treasury_token),true),(6,payment_v2.b58(a.refund_token),true),
 (7,payment_v2.b58(n.token_program),false),(8,'Sysvar1nstructions1111111111111111111111111',false)) v(pos,key,writable);
 RETURN jsonb_build_object('operationId',p_operation,'networkId',s.network_id,'genesis',payment_v2.b58(n.genesis),'program',payment_v2.b58(n.program),
 'action',op.action,'expectedRevision',op.expected_revision::text,'payloadDigest',encode(op.payload_digest,'hex'),
 'instruction',jsonb_build_object('programId',payment_v2.b58(n.program),'dataBase64',replace(encode(substring(sha256(convert_to('global:execute_outcome','UTF8')) FROM 1 FOR 8)||payment_v2.le64(op.expected_revision),'base64'),E'\n',''),'accounts',accounts));
END $$;
CREATE FUNCTION public.fn_payment_v2_signed_operation(p_operation_id uuid,p_lease_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o payment_v2.operations%rowtype;stored jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_executor');
 SELECT lease_id,leased_by,lease_until INTO o.lease_id,o.leased_by,o.lease_until FROM payment_v2.operations WHERE id=p_operation_id;
 IF o.lease_id IS DISTINCT FROM p_lease_id OR o.leased_by IS DISTINCT FROM session_user OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_LEASE_LOST';END IF;
 SELECT envelope INTO stored FROM payment_v2.signed_operations WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('plan',payment_v2.exit_plan(p_operation_id),'envelope',stored);
END $$;
CREATE FUNCTION public.fn_payment_v2_stage_signed_operation(p_operation_id uuid,p_lease_id uuid,p_envelope jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o payment_v2.operations%rowtype;plan jsonb;old jsonb;raw bytea;message bytea;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_executor');
 SELECT sale_id INTO o.sale_id FROM payment_v2.operations WHERE id=p_operation_id;PERFORM payment_v2.lock_sale(o.sale_id);
 SELECT lease_id,leased_by,lease_until,state INTO o.lease_id,o.leased_by,o.lease_until,o.state FROM payment_v2.operations WHERE id=p_operation_id FOR UPDATE;
 IF o.lease_id IS DISTINCT FROM p_lease_id OR o.leased_by IS DISTINCT FROM session_user OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_LEASE_LOST';END IF;
 plan:=payment_v2.exit_plan(p_operation_id);
 IF p_envelope->'plan' IS DISTINCT FROM plan THEN RAISE EXCEPTION 'PAYMENT_V2_SIGNED_OPERATION_CONTEXT';END IF;
 SELECT envelope INTO old FROM payment_v2.signed_operations WHERE operation_id=p_operation_id;
 IF FOUND THEN IF old IS DISTINCT FROM p_envelope THEN RAISE EXCEPTION 'PAYMENT_V2_SIGNED_OPERATION_IMMUTABLE';END IF;RETURN;END IF;
 IF o.state<>'leased' OR NOT EXISTS(SELECT 1 FROM payment_v2.escrows x JOIN payment_v2.operations op ON op.sale_id=x.sale_id WHERE op.id=p_operation_id AND x.state='funded' AND NOT x.held AND x.decision_revision=op.expected_revision) THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_NOT_STAGEABLE';END IF;
 IF NOT (p_envelope ?& ARRAY['transactionBase64','transactionDigest','messageDigest','signature','blockhash','lastValidBlockHeight','plan']) OR EXISTS(SELECT 1 FROM jsonb_each(p_envelope) f WHERE value='null'::jsonb) THEN RAISE EXCEPTION 'PAYMENT_V2_SIGNED_ENVELOPE_REQUIRED';END IF;
 raw:=decode(p_envelope->>'transactionBase64','base64');message:=substring(raw FROM 66);
 IF replace(encode(raw,'base64'),E'\n','') IS DISTINCT FROM p_envelope->>'transactionBase64' OR octet_length(raw) NOT BETWEEN 66 AND 1232 OR get_byte(raw,0)<>1 OR payment_v2.b58(substring(raw FROM 2 FOR 64)) IS DISTINCT FROM p_envelope->>'signature'
 OR sha256(raw) IS DISTINCT FROM decode(p_envelope->>'transactionDigest','hex') OR sha256(message) IS DISTINCT FROM decode(p_envelope->>'messageDigest','hex')
 OR (p_envelope->>'lastValidBlockHeight') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'PAYMENT_V2_SIGNED_BYTES_CONTEXT';END IF;
 INSERT INTO payment_v2.signed_operations(operation_id,network_id,envelope,signed_transaction,transaction_digest,message_digest,signature,blockhash,last_valid_block_height,staged_by)
 VALUES(p_operation_id,(plan->>'networkId')::uuid,p_envelope,raw,sha256(raw),sha256(message),p_envelope->>'signature',payment_v2.unb58(p_envelope->>'blockhash'),(p_envelope->>'lastValidBlockHeight')::numeric,session_user);
 UPDATE payment_v2.operations SET state='submitted',signature=p_envelope->>'signature' WHERE id=p_operation_id;
 -- SQL binds bytes/digests/context, but is NOT an Ed25519/message verifier. The
 -- executor must use the offline production validator before staging AND recovery.
 -- This record never authorizes financial settlement or proves broadcast success.
END $$;
DO $seal$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'fn_payment_v2_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);END LOOP;END $seal$;
COMMIT;
