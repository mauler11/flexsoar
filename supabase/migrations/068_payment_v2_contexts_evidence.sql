-- Trusted read contexts and durable chain evidence.  This does not backfill
-- pruned historical transactions or change any prior payment/ownership row.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('payment_v2.verified_chain_evidence') IS NOT NULL THEN
  RAISE EXCEPTION 'verified evidence table already exists; inspect current migration state';
 END IF;
END $preflight$;

SET LOCAL ROLE payment_v2_owner;
CREATE TABLE payment_v2.verified_chain_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 format_version smallint NOT NULL CHECK(format_version=1),
 subject_kind text NOT NULL CHECK(subject_kind IN('payment_event','attestation','lifecycle','operation_failure')),
 subject_id uuid NOT NULL,
 subject_action text NOT NULL,
 network_id uuid NOT NULL,
 genesis payment_v2.key32 NOT NULL,
 program payment_v2.key32 NOT NULL,
 signature text NOT NULL CHECK(signature ~ '^[1-9A-HJ-NP-Za-km-z]{80,96}$'),
 slot bigint NOT NULL CHECK(slot>=0),
 block_time bigint NOT NULL,
 finality text NOT NULL CHECK(finality='finalized'),
 source_kind text NOT NULL CHECK(source_kind IN('primary','archive')),
 source_label text NOT NULL CHECK(source_label ~ '^[A-Za-z0-9._:-]{1,96}$'),
 transaction_bytes bytea NOT NULL CHECK(octet_length(transaction_bytes) BETWEEN 66 AND 1232),
 transaction_digest payment_v2.key32 NOT NULL,
 message_digest payment_v2.key32 NOT NULL,
 rpc_result jsonb NOT NULL CHECK(jsonb_typeof(rpc_result)='object'),
 rpc_result_digest payment_v2.key32 NOT NULL,
 verifier_login name NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(network_id,signature),
 UNIQUE(subject_kind,subject_id,subject_action),
 FOREIGN KEY(network_id,genesis) REFERENCES payment_v2.networks(id,genesis),
 CHECK(transaction_digest=sha256(transaction_bytes)),
 CHECK(rpc_result_digest=sha256(convert_to(rpc_result::text,'UTF8'))),
 CHECK(rpc_result->>'slot'=slot::text),
 CHECK(rpc_result->>'blockTime'=block_time::text),
 CHECK(rpc_result->'meta'->'err'='null'::jsonb)
);
CREATE TRIGGER immutable_verified_chain_evidence BEFORE UPDATE OR DELETE ON payment_v2.verified_chain_evidence
 FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
ALTER TABLE payment_v2.verified_chain_evidence ENABLE ROW LEVEL SECURITY;
RESET ROLE;

CREATE FUNCTION payment_v2.consumption_digest(p_event uuid) RETURNS bytea
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e payment_v2.events%rowtype;c payment_v2.consumptions%rowtype;
BEGIN
 SELECT id,attempt_id,sale_id,network_id,genesis,kind,signature,proof_digest INTO e.id,e.attempt_id,e.sale_id,e.network_id,e.genesis,e.kind,e.signature,e.proof_digest
  FROM payment_v2.events WHERE id=p_event;
 SELECT event_id,order_id INTO c.event_id,c.order_id FROM payment_v2.consumptions WHERE event_id=p_event;
 IF e.id IS NULL OR c.event_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_COMMITTED_CONSUMPTION_REQUIRED';END IF;
 RETURN sha256(convert_to('FLEXSOAR-CONSUMPTION-V1','UTF8')||decode('00','hex')||uuid_send(e.network_id)||uuid_send(e.id)||uuid_send(e.sale_id)||uuid_send(e.attempt_id)||uuid_send(c.order_id)||convert_to(e.kind,'UTF8')||e.genesis||e.proof_digest);
END $$;

CREATE FUNCTION public.fn_payment_v2_issuer_context(p_sale_id uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s payment_v2.sales%rowtype;v payment_v2.inventory%rowtype;n payment_v2.networks%rowtype;q payment_v2.quote_books%rowtype;actor bytea;template bytea;fee payment_v2.u64;net payment_v2.u64;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 IF p_action NOT IN('open_sale','revoke_sale') THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_ACTION_UNSUPPORTED';END IF;
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at
 INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at
 FROM payment_v2.sales WHERE id=p_sale_id;
 IF s.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_SALE_MISSING';END IF;
 n:=s.network_snapshot;
 SELECT card_id,item_id,card_commitment,pair_commitment,custody_version,generation,mode,quarantined,enrollment_evidence,enrolled_by,approved_by INTO v.card_id,v.item_id,v.card_commitment,v.pair_commitment,v.custody_version,v.generation,v.mode,v.quarantined,v.enrollment_evidence,v.enrolled_by,v.approved_by FROM payment_v2.inventory WHERE card_id=s.card_id;
 SELECT id,sale_id,total_units,fx_snapshot,valid_from,expires_at,created_at INTO q.id,q.sale_id,q.total_units,q.fx_snapshot,q.valid_from,q.expires_at,q.created_at FROM payment_v2.quote_books WHERE sale_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF p_action='open_sale' AND s.state NOT IN('opening','open') OR p_action='revoke_sale' AND (s.state NOT IN('cancel_requested','open') OR EXISTS(SELECT 1 FROM payment_v2.events WHERE sale_id=s.id AND kind IN('funded','direct'))) THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_STATE_CONFLICT';END IF;
 actor:=n.issuer;
 fee:=pg_catalog.div(q.total_units*500::numeric,10000::numeric);net:=q.total_units-fee;
 IF p_action='open_sale' THEN
  template:=decode('46534f415256320002','hex')||set_byte(decode('00','hex'),0,s.mode)||n.genesis||n.program||n.config||s.sale_commitment||v.card_commitment||v.pair_commitment||decode(repeat('00',64),'hex')||(SELECT digest FROM payment_v2.policies WHERE version=s.policy_version)||decode(repeat('00',32),'hex')||s.seller_wallet||n.treasury||n.mint||n.token_program||decode(repeat('00',32),'hex')||s.seller_token||n.treasury_token||decode(repeat('00',32),'hex')||n.issuer||payment_v2.le64(s.generation)||payment_v2.le64(s.revision)||payment_v2.le64(s.custody_version)||payment_v2.le64(n.authority_epoch)||payment_v2.le64(q.total_units)||payment_v2.le64(net)||payment_v2.le64(fee)||payment_v2.le64(q.valid_from)||payment_v2.le64(q.expires_at);
  IF octet_length(template)<>690 THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_TEMPLATE_WIRE_LENGTH';END IF;
 END IF;
 RETURN jsonb_build_object('formatVersion',1,'action',p_action,'saleId',s.id,'listingId',s.listing_id,'cardId',s.card_id,'itemId',s.item_id,
  'networkId',s.network_id,'genesis',payment_v2.b58(n.genesis),'program',payment_v2.b58(n.program),'config',payment_v2.b58(n.config),'mint',payment_v2.b58(n.mint),'tokenProgram',payment_v2.b58(n.token_program),
  'actor',payment_v2.b58(actor),'saleCommitment',payment_v2.b58(s.sale_commitment),'sale',payment_v2.b58(s.sale_address),'escrow',payment_v2.b58(s.escrow_address),
  'cardCommitment',payment_v2.b58(v.card_commitment),'pairCommitment',payment_v2.b58(v.pair_commitment),'custodyVersion',v.custody_version::text,'generation',s.generation::text,'revision',s.revision::text,'mode',s.mode,
  'seller',payment_v2.b58(s.seller_wallet),'sellerToken',payment_v2.b58(s.seller_token),'treasury',payment_v2.b58(n.treasury),'treasuryToken',payment_v2.b58(n.treasury_token),'policyVersion',s.policy_version,
  'totalUnits',q.total_units::text,'validFrom',q.valid_from::text,'expiresAt',q.expires_at::text,'templateHex',CASE WHEN template IS NULL THEN NULL ELSE encode(template,'hex') END,'state',s.state);
END $$;

CREATE FUNCTION public.fn_payment_v2_verifier_context(p_kind text,p_subject_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d payment_v2.decisions%rowtype;x payment_v2.escrows%rowtype;s payment_v2.sales%rowtype;st payment_v2.staff%rowtype;keys jsonb;action_code integer;ix_name text;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 IF p_kind='decision' THEN
  SELECT id,escrow_id,action,expected_revision,actor_staff,person_id,pair_commitment,evidence_digest,payload,created_at INTO d.id,d.escrow_id,d.action,d.expected_revision,d.actor_staff,d.person_id,d.pair_commitment,d.evidence_digest,d.payload,d.created_at FROM payment_v2.decisions WHERE id=p_subject_id;
  SELECT id,sale_id,attempt_id,order_id,funding_event,terminal_event,state,decision_revision,held,dispatch_evidence,dispatch_due,review_after,received_at,authentication INTO x.id,x.sale_id,x.attempt_id,x.order_id,x.funding_event,x.terminal_event,x.state,x.decision_revision,x.held,x.dispatch_evidence,x.dispatch_due,x.review_after,x.received_at,x.authentication FROM payment_v2.escrows WHERE id=d.escrow_id;
  SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=x.sale_id;
  SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE id=d.actor_staff;
  IF d.id IS NULL OR s.id IS NULL OR st.id IS NULL OR NOT st.active THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_DECISION_MISSING';END IF;
  ix_name:=CASE d.action WHEN 'receipt' THEN 'record_receipt' WHEN 'authentication_pass' THEN 'record_authentication' WHEN 'authentication_fail' THEN 'record_authentication' WHEN 'review_authentication_pass' THEN 'review_authentication' WHEN 'review_authentication_fail' THEN 'review_authentication' WHEN 'release' THEN 'authorize_release' WHEN 'refund' THEN 'authorize_refund' WHEN 'dispute' THEN 'dispute_hold' WHEN 'resolve_dispute_release' THEN 'resolve_dispute' WHEN 'resolve_dispute_refund' THEN 'resolve_dispute' ELSE NULL END;
  action_code:=CASE d.action WHEN 'receipt' THEN 0 WHEN 'authentication_pass' THEN 1 WHEN 'authentication_fail' THEN 2 WHEN 'release' THEN 3 WHEN 'refund' THEN 4 WHEN 'dispute' THEN 5 WHEN 'resolve_dispute_release' THEN 6 WHEN 'resolve_dispute_refund' THEN 7 WHEN 'review_authentication_pass' THEN 8 WHEN 'review_authentication_fail' THEN 8 ELSE NULL END;
  IF ix_name IS NULL OR action_code IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_ACTION_UNSUPPORTED';END IF;
  IF d.action IN('refund','resolve_dispute_release','resolve_dispute_refund') THEN
   SELECT coalesce(jsonb_agg(payment_v2.b58(g.public_key) ORDER BY g.staff_id),'[]'::jsonb) INTO keys FROM payment_v2.governance_approvals a JOIN payment_v2.staff g ON g.id=a.staff_id WHERE a.decision_id=d.id AND g.active AND g.role='governor';
   IF jsonb_array_length(keys)<>2 THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_GOVERNANCE_INCOMPLETE';END IF;
  ELSE keys:=jsonb_build_array(payment_v2.b58(st.public_key));END IF;
  RETURN jsonb_build_object('formatVersion',1,'kind','decision','decisionId',d.id,'action',d.action,'instruction',ix_name,'actionCode',action_code,'saleId',s.id,'escrowId',x.id,'networkId',s.network_id,'genesis',payment_v2.b58((s.network_snapshot).genesis),'program',payment_v2.b58((s.network_snapshot).program),'config',payment_v2.b58((s.network_snapshot).config),'sale',payment_v2.b58(s.sale_address),'attempt',payment_v2.b58((SELECT attempt_commitment FROM payment_v2.attempts WHERE id=x.attempt_id)),'pairCommitment',payment_v2.b58(d.pair_commitment),'evidenceDigest',payment_v2.b58(d.evidence_digest),'expectedRevision',d.expected_revision::text,'resultingRevision',(d.expected_revision+CASE WHEN d.action IN('release','refund','dispute','resolve_dispute_release','resolve_dispute_refund') THEN 1 ELSE 0 END)::text,'actorStaffId',st.id,'actorPersonId',st.person_id,'actors',keys,'refundReason',d.payload->>'refundReason');
 END IF;
 IF p_kind='attempt' THEN
  RETURN (SELECT jsonb_build_object('formatVersion',1,'kind','attempt','attemptId',a.id,'saleId',s.id,'listingId',s.listing_id,'cardId',s.card_id,'itemId',s.item_id,'buyerId',a.buyer_id,'sellerId',s.seller_id,'networkId',s.network_id,'genesis',payment_v2.b58((s.network_snapshot).genesis),'program',payment_v2.b58((s.network_snapshot).program),'config',payment_v2.b58((s.network_snapshot).config),'sale',payment_v2.b58(s.sale_address),'attemptCommitment',payment_v2.b58(a.attempt_commitment),'permitHex',encode(a.permit,'hex'),'mode',s.mode,'generation',s.generation::text,'revision',s.revision::text,'custodyVersion',s.custody_version::text,'buyerWallet',payment_v2.b58(a.buyer_wallet),'sellerWallet',payment_v2.b58(a.seller_wallet),'buyerToken',payment_v2.b58(a.buyer_token),'sellerToken',payment_v2.b58(a.seller_token),'treasuryToken',payment_v2.b58(a.treasury_token),'refundToken',payment_v2.b58(a.refund_token),'totalUnits',a.total_units::text,'netUnits',a.net_units::text,'feeUnits',a.fee_units::text,'validFrom',a.valid_from::text,'expiresAt',a.expires_at::text)
   FROM payment_v2.attempts a JOIN payment_v2.sales s ON s.id=a.sale_id WHERE a.id=p_subject_id AND a.permit IS NOT NULL);
 END IF;
 IF p_kind='lifecycle' THEN
  SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=p_subject_id;
  IF s.id IS NULL OR s.state NOT IN('opening','open','cancel_requested','revoked','direct','released','refunded') THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_LIFECYCLE_MISSING';END IF;
  RETURN jsonb_build_object('formatVersion',1,'kind','lifecycle','saleId',s.id,'listingId',s.listing_id,'cardId',s.card_id,'itemId',s.item_id,'networkId',s.network_id,'genesis',payment_v2.b58((s.network_snapshot).genesis),'program',payment_v2.b58((s.network_snapshot).program),'config',payment_v2.b58((s.network_snapshot).config),'sale',payment_v2.b58(s.sale_address),'saleCommitment',payment_v2.b58(s.sale_commitment),'generation',s.generation::text,'revision',s.revision::text,'state',s.state,'allowedActions',CASE WHEN s.state='opening' THEN jsonb_build_array('opened') WHEN s.state='cancel_requested' THEN jsonb_build_array('revoked') WHEN s.state='open' THEN jsonb_build_array('revoked') WHEN s.state IN('direct','released','refunded') THEN jsonb_build_array('acknowledged') ELSE '[]'::jsonb END);
 END IF;
 RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_KIND_UNSUPPORTED';
END $$;

CREATE FUNCTION public.fn_payment_v2_ack_context(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e payment_v2.events%rowtype;c payment_v2.consumptions%rowtype;s payment_v2.sales%rowtype;v payment_v2.inventory%rowtype;actors jsonb;old jsonb;digest bytea;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_settler');
 SELECT id,attempt_id,sale_id,network_id,genesis,kind,signature,slot,proof_digest INTO e.id,e.attempt_id,e.sale_id,e.network_id,e.genesis,e.kind,e.signature,e.slot,e.proof_digest FROM payment_v2.events WHERE id=p_event_id;
 SELECT event_id,order_id,result INTO c.event_id,c.order_id,c.result FROM payment_v2.consumptions WHERE event_id=p_event_id;
 IF e.id IS NULL OR c.event_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_COMMITTED_CONSUMPTION_REQUIRED';END IF;
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=e.sale_id;
 SELECT card_id,item_id,card_commitment,pair_commitment,custody_version,generation,mode,quarantined,enrollment_evidence,enrolled_by,approved_by INTO v.card_id,v.item_id,v.card_commitment,v.pair_commitment,v.custody_version,v.generation,v.mode,v.quarantined,v.enrollment_evidence,v.enrolled_by,v.approved_by FROM payment_v2.inventory WHERE card_id=s.card_id;
 SELECT coalesce(jsonb_agg(payment_v2.b58(public_key) ORDER BY id),'[]'::jsonb) INTO actors FROM payment_v2.staff WHERE active AND role='reconciler';
 IF jsonb_array_length(actors)<>1 OR s.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_ACK_AUTHORITY_AMBIGUOUS';END IF;
 SELECT proof INTO old FROM payment_v2.lifecycle_evidence WHERE sale_id=s.id AND kind='acknowledged';
 digest:=payment_v2.consumption_digest(e.id);
 RETURN jsonb_build_object('formatVersion',1,'eventId',e.id,'saleId',s.id,'saleCommitment',payment_v2.b58(s.sale_commitment),'cardId',s.card_id,'cardCommitment',payment_v2.b58(v.card_commitment),'attemptId',e.attempt_id,'attemptCommitment',payment_v2.b58((SELECT attempt_commitment FROM payment_v2.attempts WHERE id=e.attempt_id)),'orderId',c.order_id,'networkId',e.network_id,'genesis',payment_v2.b58(e.genesis),'program',payment_v2.b58((s.network_snapshot).program),'config',payment_v2.b58((s.network_snapshot).config),'sale',payment_v2.b58(s.sale_address),'kind',e.kind,'signature',e.signature,'slot',e.slot::text,'proofDigest',encode(e.proof_digest,'hex'),'actors',actors,'consumptionDigest',encode(digest,'hex'),'receipt',old);
END $$;

CREATE FUNCTION public.fn_payment_v2_store_chain_evidence(p_evidence jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n payment_v2.networks%rowtype;a payment_v2.attempts%rowtype;s payment_v2.sales%rowtype;d payment_v2.decisions%rowtype;x payment_v2.escrows%rowtype;o payment_v2.operations%rowtype;
 raw bytea;existing payment_v2.verified_chain_evidence%rowtype;v_id uuid;sid uuid:=(p_evidence->>'subjectId')::uuid;kind text:=p_evidence->>'subjectKind';action text:=p_evidence->>'subjectAction';net uuid:=(p_evidence->>'networkId')::uuid;slot_value bigint:=(p_evidence->>'slot')::bigint;time_value bigint:=(p_evidence->>'blockTime')::bigint;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');PERFORM payment_v2.proof_shape(p_evidence);
 IF NOT (p_evidence ?& ARRAY['formatVersion','subjectKind','subjectId','subjectAction','networkId','genesis','program','signature','slot','blockTime','finality','sourceKind','sourceLabel','transactionBase64','transactionDigest','messageDigest','rpcResult']) OR p_evidence->>'formatVersion'<>'1' OR p_evidence->>'finality'<>'finalized' OR p_evidence->>'sourceKind' NOT IN('primary','archive') OR p_evidence->>'transactionBase64' IS NULL OR p_evidence->>'messageDigest' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_evidence->'rpcResult')<>'object' THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_EVIDENCE_SHAPE';END IF;
 raw:=decode(p_evidence->>'transactionBase64','base64');
 IF replace(encode(raw,'base64'),E'\n','') IS DISTINCT FROM p_evidence->>'transactionBase64' OR octet_length(raw) NOT BETWEEN 66 AND 1232 OR get_byte(raw,0) NOT BETWEEN 1 AND 127 OR octet_length(raw)<1+get_byte(raw,0)*64 OR payment_v2.b58(substring(raw FROM 2 FOR 64)) IS DISTINCT FROM p_evidence->>'signature' THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_TRANSACTION_IDENTITY';END IF;
 IF (p_evidence->>'transactionDigest') IS DISTINCT FROM encode(sha256(raw),'hex') OR (p_evidence->'rpcResult'->'transaction'->>0) IS DISTINCT FROM p_evidence->>'transactionBase64' OR p_evidence->'rpcResult'->'transaction'->>1 IS DISTINCT FROM 'base64' OR (p_evidence->'rpcResult'->'meta'->'err') IS DISTINCT FROM 'null'::jsonb OR (p_evidence->'rpcResult'->>'slot')::bigint<>slot_value OR (p_evidence->'rpcResult'->>'blockTime')::bigint<>time_value THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_RESULT_MISMATCH';END IF;
 SELECT id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units INTO n.id,n.genesis,n.program,n.config,n.mint,n.token_program,n.treasury,n.treasury_token,n.issuer,n.authority_epoch,n.policy_version,n.funding_enabled,n.max_trade_units,n.max_escrow_units FROM payment_v2.networks WHERE id=net AND genesis=payment_v2.unb58(p_evidence->>'genesis') AND program=payment_v2.unb58(p_evidence->>'program');
 IF n.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_NETWORK_MISMATCH';END IF;
 IF kind='payment_event' THEN
  SELECT id,sale_id,network_id,permit,mode INTO a.id,a.sale_id,a.network_id,a.permit,a.state FROM payment_v2.attempts WHERE id=sid;
  SELECT id,network_id,sale_address,mode,network_snapshot INTO s.id,s.network_id,s.sale_address,s.mode,s.network_snapshot FROM payment_v2.sales WHERE id=a.sale_id;
  IF a.id IS NULL OR a.network_id<>net OR s.id IS NULL OR (s.network_snapshot).genesis<>n.genesis OR action NOT IN('funded','direct','released','refunded') OR (s.mode=0 AND action='direct') OR (s.mode=1 AND action NOT IN('direct','funded')) THEN RAISE EXCEPTION 'PAYMENT_V2_EVIDENCE_SUBJECT_MISMATCH';END IF;
 ELSIF kind='attestation' THEN
  SELECT id,escrow_id,action INTO d.id,d.escrow_id,d.action FROM payment_v2.decisions WHERE id=sid;
  SELECT sale_id INTO x.sale_id FROM payment_v2.escrows WHERE id=d.escrow_id;
  SELECT id,network_id,sale_address,network_snapshot INTO s.id,s.network_id,s.sale_address,s.network_snapshot FROM payment_v2.sales WHERE id=x.sale_id;
  IF d.id IS NULL OR d.action<>action OR s.id IS NULL OR s.network_id<>net THEN RAISE EXCEPTION 'PAYMENT_V2_EVIDENCE_SUBJECT_MISMATCH';END IF;
 ELSIF kind='lifecycle' THEN
  SELECT id,network_id,sale_address,state,network_snapshot INTO s.id,s.network_id,s.sale_address,s.state,s.network_snapshot FROM payment_v2.sales WHERE id=sid;
  IF s.id IS NULL OR s.network_id<>net OR action NOT IN('opened','revoked','acknowledged') OR (action='acknowledged' AND (s.state NOT IN('direct','released','refunded') OR NOT EXISTS(SELECT 1 FROM payment_v2.events e JOIN payment_v2.consumptions c ON c.event_id=e.id WHERE e.sale_id=s.id AND e.kind=s.state))) THEN RAISE EXCEPTION 'PAYMENT_V2_EVIDENCE_SUBJECT_MISMATCH';END IF;
 ELSIF kind='operation_failure' THEN
  SELECT id,sale_id,signature INTO o.id,o.sale_id,o.signature FROM payment_v2.operations WHERE id=sid;
  SELECT network_id,network_snapshot INTO s.network_id,s.network_snapshot FROM payment_v2.sales WHERE id=o.sale_id;
  IF o.id IS NULL OR o.signature<>p_evidence->>'signature' OR action<>'finalized_failure' OR s.network_id<>net THEN RAISE EXCEPTION 'PAYMENT_V2_EVIDENCE_SUBJECT_MISMATCH';END IF;
 ELSE RAISE EXCEPTION 'PAYMENT_V2_EVIDENCE_SUBJECT_UNSUPPORTED';END IF;
 IF payment_v2.unb58(p_evidence->>'genesis') IS DISTINCT FROM (s.network_snapshot).genesis OR payment_v2.unb58(p_evidence->>'program') IS DISTINCT FROM (s.network_snapshot).program THEN RAISE EXCEPTION 'PAYMENT_V2_EVIDENCE_BINDING_MISMATCH';END IF;
 SELECT id,format_version,subject_kind,subject_id,subject_action,network_id,genesis,program,signature,slot,block_time,finality,source_kind,source_label,transaction_bytes,transaction_digest,message_digest,rpc_result,rpc_result_digest,verifier_login,verified_at
 INTO existing.id,existing.format_version,existing.subject_kind,existing.subject_id,existing.subject_action,existing.network_id,existing.genesis,existing.program,existing.signature,existing.slot,existing.block_time,existing.finality,existing.source_kind,existing.source_label,existing.transaction_bytes,existing.transaction_digest,existing.message_digest,existing.rpc_result,existing.rpc_result_digest,existing.verifier_login,existing.verified_at
 FROM payment_v2.verified_chain_evidence WHERE network_id=net AND signature=p_evidence->>'signature' OR subject_kind=kind AND subject_id=sid AND subject_action=action;
 IF FOUND THEN
  IF existing.subject_kind<>kind OR existing.subject_id<>sid OR existing.subject_action<>action OR existing.signature<>p_evidence->>'signature' OR existing.transaction_bytes<>raw OR existing.rpc_result IS DISTINCT FROM p_evidence->'rpcResult' OR existing.source_kind<>p_evidence->>'sourceKind' THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_EVIDENCE_CONFLICT';END IF;
  RETURN existing.id;
 END IF;
 INSERT INTO payment_v2.verified_chain_evidence(format_version,subject_kind,subject_id,subject_action,network_id,genesis,program,signature,slot,block_time,finality,source_kind,source_label,transaction_bytes,transaction_digest,message_digest,rpc_result,rpc_result_digest,verifier_login)
 VALUES(1,kind,sid,action,net,n.genesis,n.program,p_evidence->>'signature',slot_value,time_value,'finalized',p_evidence->>'sourceKind',p_evidence->>'sourceLabel',raw,sha256(raw),decode(p_evidence->>'messageDigest','hex'),p_evidence->'rpcResult',sha256(convert_to((p_evidence->'rpcResult')::text,'UTF8')),session_user) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.fn_payment_v2_read_chain_evidence(p_subject_kind text,p_subject_id uuid,p_subject_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 RETURN (SELECT jsonb_build_object('id',id,'formatVersion',format_version,'subjectKind',subject_kind,'subjectId',subject_id,'subjectAction',subject_action,'networkId',network_id,'genesis',payment_v2.b58(genesis),'program',payment_v2.b58(program),'signature',signature,'slot',slot::text,'blockTime',block_time::text,'finality',finality,'sourceKind',source_kind,'sourceLabel',source_label,'transactionBase64',encode(transaction_bytes,'base64'),'transactionDigest',encode(transaction_digest,'hex'),'messageDigest',encode(message_digest,'hex'),'rpcResult',rpc_result,'rpcResultDigest',encode(rpc_result_digest,'hex')) FROM payment_v2.verified_chain_evidence WHERE subject_kind=p_subject_kind AND subject_id=p_subject_id AND subject_action=p_subject_action);
END $$;

CREATE FUNCTION payment_v2.evidence_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ev payment_v2.verified_chain_evidence%rowtype;expected_action text;sid uuid;sig text;slot_value bigint;network uuid;genesis_bytes bytea;program_bytes bytea;evidence_id uuid;
BEGIN
 IF TG_TABLE_NAME='events' THEN sid:=NEW.attempt_id;expected_action:=NEW.kind;sig:=NEW.signature;slot_value:=NEW.slot;network:=NEW.network_id;genesis_bytes:=NEW.genesis;evidence_id:=(NEW.proof->>'evidenceId')::uuid;
  SELECT (network_snapshot).program INTO program_bytes FROM payment_v2.sales WHERE id=NEW.sale_id;
 ELSIF TG_TABLE_NAME='attestations' THEN sid:=NEW.decision_id;sig:=NEW.signature;slot_value:=NEW.slot;evidence_id:=(NEW.proof->>'evidenceId')::uuid;SELECT action INTO expected_action FROM payment_v2.decisions WHERE id=sid;
  SELECT sale.network_id,(sale.network_snapshot).genesis,(sale.network_snapshot).program INTO network,genesis_bytes,program_bytes FROM payment_v2.decisions decision JOIN payment_v2.escrows escrow ON escrow.id=decision.escrow_id JOIN payment_v2.sales sale ON sale.id=escrow.sale_id WHERE decision.id=sid;
 ELSIF TG_TABLE_NAME='lifecycle_evidence' THEN sid:=NEW.sale_id;expected_action:=NEW.kind;sig:=NEW.signature;slot_value:=(NEW.proof->>'slot')::bigint;evidence_id:=(NEW.proof->>'evidenceId')::uuid;SELECT network_id,(network_snapshot).genesis,(network_snapshot).program INTO network,genesis_bytes,program_bytes FROM payment_v2.sales WHERE id=sid;
 ELSIF TG_TABLE_NAME='operation_failures' THEN sid:=NEW.operation_id;expected_action:='finalized_failure';sig:=NEW.proof->>'signature';slot_value:=(NEW.proof->>'slot')::bigint;evidence_id:=(NEW.proof->>'evidenceId')::uuid;SELECT sale.network_id,(sale.network_snapshot).genesis,(sale.network_snapshot).program INTO network,genesis_bytes,program_bytes FROM payment_v2.operations operation JOIN payment_v2.sales sale ON sale.id=operation.sale_id WHERE operation.id=sid;
 ELSE RAISE EXCEPTION 'PAYMENT_V2_EVIDENCE_TRIGGER_UNSUPPORTED';END IF;
 SELECT id,format_version,subject_kind,subject_id,subject_action,network_id,genesis,program,signature,slot,block_time,finality,source_kind,source_label,transaction_bytes,transaction_digest,message_digest,rpc_result,rpc_result_digest,verifier_login,verified_at
 INTO ev.id,ev.format_version,ev.subject_kind,ev.subject_id,ev.subject_action,ev.network_id,ev.genesis,ev.program,ev.signature,ev.slot,ev.block_time,ev.finality,ev.source_kind,ev.source_label,ev.transaction_bytes,ev.transaction_digest,ev.message_digest,ev.rpc_result,ev.rpc_result_digest,ev.verifier_login,ev.verified_at
 FROM payment_v2.verified_chain_evidence WHERE id=evidence_id;
 IF ev.id IS NULL OR ev.subject_kind IS DISTINCT FROM (CASE TG_TABLE_NAME WHEN 'events' THEN 'payment_event' WHEN 'attestations' THEN 'attestation' WHEN 'lifecycle_evidence' THEN 'lifecycle' ELSE 'operation_failure' END) OR ev.subject_id<>sid OR ev.subject_action<>expected_action OR ev.signature<>sig OR ev.slot<>slot_value OR ev.network_id<>network OR ev.genesis IS DISTINCT FROM genesis_bytes OR (program_bytes IS NOT NULL AND ev.program IS DISTINCT FROM program_bytes) THEN RAISE EXCEPTION 'PAYMENT_V2_RETAINED_EVIDENCE_REQUIRED';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evidence_before_event BEFORE INSERT ON payment_v2.events FOR EACH ROW EXECUTE FUNCTION payment_v2.evidence_insert_guard();
CREATE TRIGGER evidence_before_attestation BEFORE INSERT ON payment_v2.attestations FOR EACH ROW EXECUTE FUNCTION payment_v2.evidence_insert_guard();
CREATE TRIGGER evidence_before_lifecycle BEFORE INSERT ON payment_v2.lifecycle_evidence FOR EACH ROW EXECUTE FUNCTION payment_v2.evidence_insert_guard();
CREATE TRIGGER evidence_before_operation_failure BEFORE INSERT ON payment_v2.operation_failures FOR EACH ROW EXECUTE FUNCTION payment_v2.evidence_insert_guard();
CREATE FUNCTION payment_v2.consumption_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e payment_v2.events%rowtype;ev payment_v2.verified_chain_evidence%rowtype;
BEGIN
 SELECT id,attempt_id,sale_id,network_id,genesis,kind,signature,slot,proof INTO e.id,e.attempt_id,e.sale_id,e.network_id,e.genesis,e.kind,e.signature,e.slot,e.proof FROM payment_v2.events WHERE id=NEW.event_id;
 SELECT id,subject_kind,subject_id,subject_action,network_id,genesis,signature,slot INTO ev.id,ev.subject_kind,ev.subject_id,ev.subject_action,ev.network_id,ev.genesis,ev.signature,ev.slot FROM payment_v2.verified_chain_evidence WHERE id=(e.proof->>'evidenceId')::uuid;
 IF ev.id IS NULL OR ev.subject_kind<>'payment_event' OR ev.subject_id<>e.attempt_id OR ev.subject_action<>e.kind OR ev.network_id<>e.network_id OR ev.genesis<>e.genesis OR ev.signature<>e.signature OR ev.slot<>e.slot THEN RAISE EXCEPTION 'PAYMENT_V2_RETAINED_EVIDENCE_REQUIRED';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consumption_evidence_before_insert BEFORE INSERT ON payment_v2.consumptions FOR EACH ROW EXECUTE FUNCTION payment_v2.consumption_evidence_guard();

DO $owners$
DECLARE f record;
BEGIN
 ALTER TABLE payment_v2.verified_chain_evidence OWNER TO payment_v2_owner;
 ALTER FUNCTION payment_v2.consumption_digest(uuid) OWNER TO payment_v2_owner;
 ALTER FUNCTION payment_v2.evidence_insert_guard() OWNER TO payment_v2_owner;
 ALTER FUNCTION payment_v2.consumption_evidence_guard() OWNER TO payment_v2_owner;
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('fn_payment_v2_issuer_context','fn_payment_v2_verifier_context','fn_payment_v2_ack_context','fn_payment_v2_store_chain_evidence','fn_payment_v2_read_chain_evidence') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO payment_v2_owner',f.sig);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
 REVOKE ALL ON payment_v2.verified_chain_evidence FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
 REVOKE ALL ON FUNCTION payment_v2.consumption_digest(uuid) FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
 REVOKE ALL ON FUNCTION payment_v2.evidence_insert_guard() FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
 REVOKE ALL ON FUNCTION payment_v2.consumption_evidence_guard() FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
END $owners$;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_issuer_context(uuid,text) TO payment_v2_issuer;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_verifier_context(text,uuid),public.fn_payment_v2_store_chain_evidence(jsonb),public.fn_payment_v2_read_chain_evidence(text,uuid,text) TO payment_v2_verifier;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_ack_context(uuid) TO payment_v2_settler;
COMMIT;
