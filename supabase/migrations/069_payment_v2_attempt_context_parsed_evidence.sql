-- Extend the new 068 evidence envelope with the separately parsed transaction
-- needed for offline instruction revalidation. No prior evidence is rewritten.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('payment_v2.verified_chain_evidence') IS NULL OR to_regprocedure('public.fn_payment_v2_store_chain_evidence(jsonb)') IS NULL THEN
  RAISE EXCEPTION '069 requires committed 068 contexts/evidence objects';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='payment_v2.verified_chain_evidence'::regclass AND attname IN('parsed_rpc_result','parsed_result_digest') AND NOT attisdropped) THEN
  RAISE EXCEPTION '069 parsed-evidence columns already exist; inspect catalog and prepare a forward repair';
 END IF;
END $preflight$;

ALTER TABLE payment_v2.verified_chain_evidence
 ADD COLUMN parsed_rpc_result jsonb,
 ADD COLUMN parsed_result_digest payment_v2.key32;
ALTER TABLE payment_v2.verified_chain_evidence OWNER TO payment_v2_owner;

CREATE OR REPLACE FUNCTION public.fn_payment_v2_attempt_context(p_attempt text,p_genesis text,p_program text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a payment_v2.attempts%rowtype;s payment_v2.sales%rowtype;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 SELECT id,idempotency_key,buyer_id,sale_id,listing_id,card_id,item_id,seller_id,network_id,quote_id,attempt_commitment,beneficiary,buyer_wallet,seller_wallet,buyer_token,seller_token,treasury_token,refund_token,policy_version,total_units,net_units,fee_units,gross_cents,fee_cents,net_cents,valid_from,expires_at,permit,authorized_by,authorized_at,state,created_at INTO a.id,a.idempotency_key,a.buyer_id,a.sale_id,a.listing_id,a.card_id,a.item_id,a.seller_id,a.network_id,a.quote_id,a.attempt_commitment,a.beneficiary,a.buyer_wallet,a.seller_wallet,a.buyer_token,a.seller_token,a.treasury_token,a.refund_token,a.policy_version,a.total_units,a.net_units,a.fee_units,a.gross_cents,a.fee_cents,a.net_cents,a.valid_from,a.expires_at,a.permit,a.authorized_by,a.authorized_at,a.state,a.created_at FROM payment_v2.attempts WHERE attempt_commitment=payment_v2.unb58(p_attempt);
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=a.sale_id;
 IF a.id IS NULL OR a.permit IS NULL OR payment_v2.unb58(p_genesis) IS DISTINCT FROM (s.network_snapshot).genesis OR payment_v2.unb58(p_program) IS DISTINCT FROM (s.network_snapshot).program THEN RAISE EXCEPTION 'PAYMENT_V2_CONTEXT_ATTEMPT_MISMATCH';END IF;
 RETURN jsonb_build_object('formatVersion',1,'attemptId',a.id,'saleId',s.id,'listingId',s.listing_id,'cardId',s.card_id,'itemId',s.item_id,'buyerId',a.buyer_id,'sellerId',s.seller_id,'networkId',s.network_id,'genesis',payment_v2.b58((s.network_snapshot).genesis),'program',payment_v2.b58((s.network_snapshot).program),'config',payment_v2.b58((s.network_snapshot).config),'sale',payment_v2.b58(s.sale_address),'saleCommitment',payment_v2.b58(s.sale_commitment),'attemptCommitment',payment_v2.b58(a.attempt_commitment),'permitHex',encode(a.permit,'hex'),'mode',s.mode,'generation',s.generation::text,'revision',s.revision::text,'custodyVersion',s.custody_version::text,'buyerWallet',payment_v2.b58(a.buyer_wallet),'sellerWallet',payment_v2.b58(a.seller_wallet),'buyerToken',payment_v2.b58(a.buyer_token),'sellerToken',payment_v2.b58(a.seller_token),'treasuryToken',payment_v2.b58(a.treasury_token),'refundToken',payment_v2.b58(a.refund_token),'totalUnits',a.total_units::text,'netUnits',a.net_units::text,'feeUnits',a.fee_units::text,'validFrom',a.valid_from::text,'expiresAt',a.expires_at::text);
END $$;

CREATE OR REPLACE FUNCTION public.fn_payment_v2_store_chain_evidence(p_evidence jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n payment_v2.networks%rowtype;a payment_v2.attempts%rowtype;s payment_v2.sales%rowtype;d payment_v2.decisions%rowtype;x payment_v2.escrows%rowtype;o payment_v2.operations%rowtype;
 raw bytea;existing payment_v2.verified_chain_evidence%rowtype;v_id uuid;sid uuid:=(p_evidence->>'subjectId')::uuid;kind text:=p_evidence->>'subjectKind';action text:=p_evidence->>'subjectAction';net uuid:=(p_evidence->>'networkId')::uuid;slot_value bigint:=(p_evidence->>'slot')::bigint;time_value bigint:=(p_evidence->>'blockTime')::bigint;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');PERFORM payment_v2.proof_shape(p_evidence);
 IF NOT (p_evidence ?& ARRAY['formatVersion','subjectKind','subjectId','subjectAction','networkId','genesis','program','signature','slot','blockTime','finality','sourceKind','sourceLabel','transactionBase64','transactionDigest','messageDigest','rpcResult','parsedRpcResult']) OR p_evidence->>'formatVersion'<>'1' OR p_evidence->>'finality'<>'finalized' OR p_evidence->>'sourceKind' NOT IN('primary','archive') OR p_evidence->>'transactionBase64' IS NULL OR p_evidence->>'messageDigest' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_evidence->'rpcResult')<>'object' OR jsonb_typeof(p_evidence->'parsedRpcResult')<>'object' THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_EVIDENCE_SHAPE';END IF;
 raw:=decode(p_evidence->>'transactionBase64','base64');
 IF replace(encode(raw,'base64'),E'\n','') IS DISTINCT FROM p_evidence->>'transactionBase64' OR octet_length(raw) NOT BETWEEN 66 AND 1232 OR get_byte(raw,0) NOT BETWEEN 1 AND 127 OR octet_length(raw)<1+get_byte(raw,0)*64 OR payment_v2.b58(substring(raw FROM 2 FOR 64)) IS DISTINCT FROM p_evidence->>'signature' THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_TRANSACTION_IDENTITY';END IF;
 IF (p_evidence->>'transactionDigest') IS DISTINCT FROM encode(sha256(raw),'hex') OR (p_evidence->'rpcResult'->'transaction'->>0) IS DISTINCT FROM p_evidence->>'transactionBase64' OR p_evidence->'rpcResult'->'transaction'->>1 IS DISTINCT FROM 'base64' OR (p_evidence->'rpcResult'->'meta'->'err') IS DISTINCT FROM 'null'::jsonb OR (p_evidence->'rpcResult'->>'slot')::bigint<>slot_value OR (p_evidence->'rpcResult'->>'blockTime')::bigint<>time_value THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_RESULT_MISMATCH';END IF;
 IF (p_evidence->'parsedRpcResult'->>'slot')::bigint<>slot_value OR (p_evidence->'parsedRpcResult'->>'blockTime')::bigint<>time_value OR p_evidence->'parsedRpcResult'->'meta' IS DISTINCT FROM p_evidence->'rpcResult'->'meta' OR p_evidence->'parsedRpcResult'->'transaction'->'signatures'->>0 IS DISTINCT FROM p_evidence->>'signature' THEN RAISE EXCEPTION 'PAYMENT_V2_PARSED_RESULT_MISMATCH';END IF;
 SELECT id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units INTO n.id,n.genesis,n.program,n.config,n.mint,n.token_program,n.treasury,n.treasury_token,n.issuer,n.authority_epoch,n.policy_version,n.funding_enabled,n.max_trade_units,n.max_escrow_units FROM payment_v2.networks WHERE id=net AND genesis=payment_v2.unb58(p_evidence->>'genesis') AND program=payment_v2.unb58(p_evidence->>'program');
 IF n.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_NETWORK_MISMATCH';END IF;
 IF kind='payment_event' THEN
  SELECT id,sale_id,network_id,permit,state INTO a.id,a.sale_id,a.network_id,a.permit,a.state FROM payment_v2.attempts WHERE id=sid;
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
 SELECT id,format_version,subject_kind,subject_id,subject_action,network_id,genesis,program,signature,slot,block_time,finality,source_kind,source_label,transaction_bytes,transaction_digest,message_digest,rpc_result,rpc_result_digest,verifier_login,verified_at,parsed_rpc_result,parsed_result_digest INTO existing.id,existing.format_version,existing.subject_kind,existing.subject_id,existing.subject_action,existing.network_id,existing.genesis,existing.program,existing.signature,existing.slot,existing.block_time,existing.finality,existing.source_kind,existing.source_label,existing.transaction_bytes,existing.transaction_digest,existing.message_digest,existing.rpc_result,existing.rpc_result_digest,existing.verifier_login,existing.verified_at,existing.parsed_rpc_result,existing.parsed_result_digest FROM payment_v2.verified_chain_evidence WHERE network_id=net AND signature=p_evidence->>'signature' OR subject_kind=kind AND subject_id=sid AND subject_action=action;
 IF FOUND THEN
  IF existing.subject_kind<>kind OR existing.subject_id<>sid OR existing.subject_action<>action OR existing.signature<>p_evidence->>'signature' OR existing.transaction_bytes<>raw OR existing.rpc_result IS DISTINCT FROM p_evidence->'rpcResult' OR existing.parsed_rpc_result IS DISTINCT FROM p_evidence->'parsedRpcResult' OR existing.source_kind<>p_evidence->>'sourceKind' THEN RAISE EXCEPTION 'PAYMENT_V2_VERIFIED_EVIDENCE_CONFLICT';END IF;
  RETURN existing.id;
 END IF;
 INSERT INTO payment_v2.verified_chain_evidence(format_version,subject_kind,subject_id,subject_action,network_id,genesis,program,signature,slot,block_time,finality,source_kind,source_label,transaction_bytes,transaction_digest,message_digest,rpc_result,rpc_result_digest,verifier_login,parsed_rpc_result,parsed_result_digest)
 VALUES(1,kind,sid,action,net,n.genesis,n.program,p_evidence->>'signature',slot_value,time_value,'finalized',p_evidence->>'sourceKind',p_evidence->>'sourceLabel',raw,sha256(raw),decode(p_evidence->>'messageDigest','hex'),p_evidence->'rpcResult',sha256(convert_to((p_evidence->'rpcResult')::text,'UTF8')),session_user,p_evidence->'parsedRpcResult',sha256(convert_to((p_evidence->'parsedRpcResult')::text,'UTF8'))) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.fn_payment_v2_read_chain_evidence(p_subject_kind text,p_subject_id uuid,p_subject_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 RETURN (SELECT jsonb_build_object('id',id,'formatVersion',format_version,'subjectKind',subject_kind,'subjectId',subject_id,'subjectAction',subject_action,'networkId',network_id,'genesis',payment_v2.b58(genesis),'program',payment_v2.b58(program),'signature',signature,'slot',slot::text,'blockTime',block_time::text,'finality',finality,'sourceKind',source_kind,'sourceLabel',source_label,'transactionBase64',encode(transaction_bytes,'base64'),'transactionDigest',encode(transaction_digest,'hex'),'messageDigest',encode(message_digest,'hex'),'rpcResult',rpc_result,'rpcResultDigest',encode(rpc_result_digest,'hex'),'parsedRpcResult',parsed_rpc_result,'parsedResultDigest',CASE WHEN parsed_result_digest IS NULL THEN NULL ELSE encode(parsed_result_digest,'hex') END) FROM payment_v2.verified_chain_evidence WHERE subject_kind=p_subject_kind AND subject_id=p_subject_id AND subject_action=p_subject_action);
END $$;

DO $owner$
BEGIN
 ALTER FUNCTION public.fn_payment_v2_attempt_context(text,text,text) OWNER TO payment_v2_owner;
 ALTER FUNCTION public.fn_payment_v2_store_chain_evidence(jsonb) OWNER TO payment_v2_owner;
 ALTER FUNCTION public.fn_payment_v2_read_chain_evidence(text,uuid,text) OWNER TO payment_v2_owner;
 REVOKE ALL ON FUNCTION public.fn_payment_v2_attempt_context(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public.fn_payment_v2_store_chain_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public.fn_payment_v2_read_chain_evidence(text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
END $owner$;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_attempt_context(text,text,text) TO payment_v2_verifier;
COMMIT;
