-- DRAFT / NOT EXECUTED. Depends on059. Public grants/ownership finalized by063.
BEGIN;
CREATE FUNCTION payment_v2.require_role(p_role name) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 -- session_user is the authenticated DB connection identity, NOT request.jwt.claims.
 IF NOT pg_has_role(session_user,p_role,'MEMBER') THEN RAISE EXCEPTION 'PAYMENT_V2_ROLE_REQUIRED: %',p_role USING ERRCODE='42501'; END IF;
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) AND (
  (SELECT count(1) FROM unnest(ARRAY['payment_v2_issuer','payment_v2_verifier','payment_v2_settler','payment_v2_executor','payment_v2_notifier']) r(name) WHERE pg_has_role(session_user,r.name::name,'MEMBER'))<>1
  OR pg_has_role(session_user,'payment_v2_owner','MEMBER') OR pg_has_role(session_user,'service_role','MEMBER') OR pg_has_role(session_user,'authenticator','MEMBER') OR pg_has_role(session_user,'authenticated','MEMBER') OR pg_has_role(session_user,'anon','MEMBER'))
 THEN RAISE EXCEPTION 'PAYMENT_V2_DEDICATED_CONNECTION_REQUIRED' USING ERRCODE='42501';END IF;
 -- Superuser is an administrative trust boundary, not an application credential.

END $$;
CREATE FUNCTION payment_v2.proof_shape(p jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(p) v WHERE v.value='null'::jsonb) THEN RAISE EXCEPTION 'PAYMENT_V2_PROOF_SHAPE';END IF;
 IF p->>'signature' IS NULL OR p->>'signature' !~ '^[1-9A-HJ-NP-Za-km-z]{80,96}$' OR p->>'slot' IS NULL OR (p->>'slot')::bigint<0 THEN RAISE EXCEPTION 'PAYMENT_V2_PROOF_SIGNATURE_SLOT';END IF;
END $$;
CREATE FUNCTION payment_v2.funding_configuration(p_network uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM payment_v2.networks n WHERE n.id=p_network AND n.max_trade_units>0 AND n.max_escrow_units>=n.max_trade_units
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['inventory','receiver','authenticator','reviewer','release','guardian','reconciler']) required(role)
 WHERE (SELECT count(1) FROM payment_v2.staff st WHERE st.role=required.role AND st.active)<>1)
 AND (SELECT count(1)=3 AND count(DISTINCT person_id)=3 FROM payment_v2.staff WHERE role='governor' AND active)
 AND (SELECT count(DISTINCT public_key)=10 FROM payment_v2.staff WHERE active)
 AND NOT EXISTS(SELECT 1 FROM payment_v2.staff WHERE active AND public_key=n.issuer)
 AND (SELECT count(DISTINCT person_id)=4 FROM payment_v2.staff WHERE active AND role IN('receiver','authenticator','reviewer','release')))
$$;
CREATE FUNCTION payment_v2.actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v uuid;
BEGIN SELECT id INTO v FROM public.users WHERE auth_id=auth.uid();
 IF v IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_SIGN_IN' USING ERRCODE='42501'; END IF; RETURN v;
END $$;
CREATE FUNCTION payment_v2.b58(p bytea) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE n numeric:=0;r text:='';i int;z int:=0;a constant text:='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
BEGIN
 FOR i IN 0..octet_length(p)-1 LOOP n:=n*256+get_byte(p,i); END LOOP;
 WHILE z<octet_length(p) AND get_byte(p,z)=0 LOOP z:=z+1; END LOOP;
 WHILE n>0 LOOP r:=substr(a,mod(n,58)::int+1,1)||r;n:=trunc(n/58);END LOOP;
 RETURN repeat('1',z)||r;
END $$;
CREATE FUNCTION payment_v2.unb58(p text) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE n numeric:=0;r bytea:=''::bytea;i int;j int;z int:=0;a constant text:='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
BEGIN
 IF p !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN RAISE EXCEPTION 'PAYMENT_V2_KEY_ENCODING'; END IF;
 FOR i IN 1..length(p) LOOP j:=strpos(a,substr(p,i,1))-1; n:=n*58+j;END LOOP;
 WHILE z<length(p) AND substr(p,z+1,1)='1' LOOP z:=z+1;END LOOP;
 WHILE n>0 LOOP r:=set_byte(decode('00','hex'),0,mod(n,256)::int)||r;n:=trunc(n/256);END LOOP;
 r:=decode(repeat('00',z),'hex')||r;
 IF octet_length(r)<>32 THEN RAISE EXCEPTION 'PAYMENT_V2_KEY_LENGTH';END IF; RETURN r;
END $$;
CREATE FUNCTION payment_v2.le64(p numeric) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE v numeric:=p;r bytea:=decode(repeat('00',8),'hex');i int;
BEGIN
 IF p<0 THEN v:=p+18446744073709551616;END IF;
 IF v<0 OR v>18446744073709551615 OR trunc(v)<>v THEN RAISE EXCEPTION 'PAYMENT_V2_INTEGER_RANGE';END IF;
 FOR i IN 0..7 LOOP r:=set_byte(r,i,mod(v,256)::int);v:=trunc(v/256);END LOOP;RETURN r;
END $$;
CREATE FUNCTION payment_v2.enqueue(p_sale uuid,p_action text,p_payload jsonb,p_revision numeric,p_command uuid DEFAULT NULL,p_decision uuid DEFAULT NULL,p_ready boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v uuid;
BEGIN
 INSERT INTO payment_v2.operations(sale_id,action,payload,payload_digest,expected_revision,command_id,decision_id,ready)
 VALUES(p_sale,p_action,p_payload,sha256(convert_to(p_payload::text,'UTF8')),p_revision,p_command,p_decision,p_ready) RETURNING id INTO v; RETURN v;
END $$;
-- Global lock order: Item -> Card -> Sale -> Listing -> Attempt -> Escrow -> Evidence/Decision -> user/account rows.
-- Initial reads find identities only; all mutable predicates are re-read under these locks.
CREATE FUNCTION payment_v2.lock_card(p_card uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_item uuid;
BEGIN
 SELECT item_id INTO v_item FROM public.cards WHERE id=p_card;
 PERFORM 1 FROM public.items WHERE id=v_item FOR UPDATE;
 PERFORM 1 FROM public.cards WHERE id=p_card FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_CARD_MISSING';END IF;
END $$;
CREATE FUNCTION payment_v2.lock_sale(p_sale uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_card uuid;v_listing uuid;
BEGIN
 SELECT card_id,listing_id INTO v_card,v_listing FROM payment_v2.sales WHERE id=p_sale;
 PERFORM payment_v2.lock_card(v_card);
 PERFORM 1 FROM payment_v2.sales WHERE id=p_sale FOR UPDATE;
 PERFORM 1 FROM public.listings WHERE id=v_listing FOR UPDATE;
END $$;
CREATE FUNCTION payment_v2.owns_claim(p_card uuid,p_owner uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT (SELECT coalesce(sum(direction),0)=1 FROM public.ledger_entries WHERE card_id=p_card AND asset='card' AND account_id=p_owner)
 AND NOT EXISTS(SELECT 1 FROM public.ledger_entries WHERE card_id=p_card AND asset='card' AND account_id IS NOT NULL AND account_id<>p_owner GROUP BY account_id HAVING sum(direction)<>0)
$$;
CREATE FUNCTION payment_v2.attempt_status(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',a.id,'listingId',a.listing_id,'mode',CASE s.mode WHEN 0 THEN 'seller_held_escrow' ELSE 'vaulted_direct' END,
 'funding',a.state,'dispatch',coalesce(e.dispatch_evidence,'not_required'),'authentication',coalesce(e.authentication,'not_required'),
 'sellerSettlement',CASE a.state WHEN 'funded' THEN 'held_in_escrow' WHEN 'direct' THEN 'released_direct' WHEN 'released' THEN 'released_escrow' WHEN 'refunded' THEN 'refunded' ELSE 'unresolved' END,
 'claim',CASE WHEN e.state='refunded' THEN 'quarantined' WHEN e.held THEN 'disputed' WHEN s.chain_acknowledged AND a.state IN('direct','released') THEN 'available' WHEN a.state='funded' THEN 'pending_vault' ELSE 'unreconciled' END,
 'signatures',coalesce((SELECT jsonb_agg(signature ORDER BY created_at) FROM payment_v2.events WHERE attempt_id=a.id),'[]'::jsonb),
 'operationPending',EXISTS(SELECT 1 FROM payment_v2.operations o WHERE o.sale_id=s.id AND o.state<>'observed'))
 FROM payment_v2.attempts a JOIN payment_v2.sales s ON s.id=a.sale_id LEFT JOIN payment_v2.escrows e ON e.attempt_id=a.id WHERE a.id=p_id
$$;
CREATE FUNCTION public.fn_payment_v2_prepare_sale(p_listing_id uuid,p_network_id uuid,p_terms jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public.listings%rowtype;c public.cards%rowtype;i public.items%rowtype;v payment_v2.inventory%rowtype;
 n payment_v2.networks%rowtype;w payment_v2.wallet_accounts%rowtype;s uuid:=(p_terms->>'id')::uuid;raw bytea;gen numeric;prior_listing uuid;prior_network uuid;prior_terms jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 SELECT card_id INTO c.id FROM public.listings WHERE id=p_listing_id;PERFORM payment_v2.lock_card(c.id);
 SELECT id,card_id,seller_id,price_cents,status INTO l.id,l.card_id,l.seller_id,l.price_cents,l.status FROM public.listings WHERE id=p_listing_id FOR UPDATE;
 SELECT listing_id,network_id,issuer_terms INTO prior_listing,prior_network,prior_terms FROM payment_v2.sales WHERE id=s;
 IF FOUND THEN IF prior_listing IS DISTINCT FROM p_listing_id OR prior_network IS DISTINCT FROM p_network_id OR prior_terms IS DISTINCT FROM p_terms THEN RAISE EXCEPTION 'PAYMENT_V2_SALE_IDEMPOTENCY_CONFLICT';END IF;RETURN s;END IF;
 SELECT id,item_id,owner_id,status INTO c.id,c.item_id,c.owner_id,c.status FROM public.cards WHERE id=l.card_id;SELECT id,custody INTO i.id,i.custody FROM public.items WHERE id=c.item_id;
 SELECT card_id,item_id,card_commitment,pair_commitment,custody_version,generation,mode,quarantined,enrollment_evidence,enrolled_by,approved_by INTO v.card_id,v.item_id,v.card_commitment,v.pair_commitment,v.custody_version,v.generation,v.mode,v.quarantined,v.enrollment_evidence,v.enrolled_by,v.approved_by FROM payment_v2.inventory WHERE card_id=c.id FOR UPDATE;
 SELECT id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units INTO n.id,n.genesis,n.program,n.config,n.mint,n.token_program,n.treasury,n.treasury_token,n.issuer,n.authority_epoch,n.policy_version,n.funding_enabled,n.max_trade_units,n.max_escrow_units FROM payment_v2.networks WHERE id=p_network_id;
 IF NOT FOUND OR NOT payment_v2.funding_configuration(p_network_id) OR NOT n.funding_enabled OR v.card_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_CONFIGURED';END IF;
 IF NOT payment_v2.owns_claim(c.id,l.seller_id) OR l.status<>'public' OR c.status<>'active' OR c.owner_id<>l.seller_id OR v.quarantined OR v.item_id<>c.item_id
 OR v.mode<>CASE i.custody WHEN 'seller' THEN 0 ELSE 1 END
 OR EXISTS(SELECT 1 FROM payment_v2.sales WHERE card_id=c.id AND fence) THEN RAISE EXCEPTION 'PAYMENT_V2_SALE_FENCED';END IF;
 SELECT wa.user_id,wa.network_id,wa.wallet,wa.token_account,wa.proof_digest INTO w.user_id,w.network_id,w.wallet,w.token_account,w.proof_digest FROM payment_v2.wallet_accounts wa JOIN public.users u ON u.id=wa.user_id
 WHERE wa.user_id=l.seller_id AND wa.network_id=n.id AND u.country_code='MY' AND u.solana_address=payment_v2.b58(wa.wallet);
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_SELLER_WALLET_REQUIRED';END IF;
 raw:=sha256(uuid_send(s));gen:=v.generation+1;
 INSERT INTO payment_v2.sales(id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms)
 VALUES(s,l.id,c.id,c.item_id,l.seller_id,n.id,raw,payment_v2.unb58(p_terms->>'saleAddress'),payment_v2.unb58(p_terms->>'escrowAddress'),gen,1,v.custody_version,v.mode,n,w.wallet,w.token_account,l.price_cents,n.policy_version,p_terms);
 INSERT INTO payment_v2.quote_books(sale_id,total_units,fx_snapshot,valid_from,expires_at)
 VALUES(s,(p_terms->>'totalUnits')::numeric,p_terms->'fxSnapshot',(p_terms->>'validFrom')::bigint,(p_terms->>'expiresAt')::bigint);
 UPDATE payment_v2.inventory SET generation=gen WHERE card_id=c.id;
 PERFORM payment_v2.enqueue(s,'open_sale',jsonb_build_object('saleId',s,'saleCommitment',payment_v2.b58(raw),'generation',gen::text),1);
 RETURN s;
END $$;
CREATE FUNCTION public.fn_payment_v2_initiate(p_listing_id uuid,p_idempotency_key uuid,p_policy_version text,p_policy_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=payment_v2.actor();a payment_v2.attempts%rowtype;s payment_v2.sales%rowtype;n payment_v2.networks%rowtype;
 q payment_v2.quote_books%rowtype;w payment_v2.wallet_accounts%rowtype;v_id uuid:=gen_random_uuid();v_card uuid;v_now bigint:=extract(epoch FROM clock_timestamp())::bigint;
BEGIN
 -- Session identity, never a supplied buyer. Exact retry works despite expiry/relink/cancellation.
 SELECT id,idempotency_key,buyer_id,sale_id,listing_id,card_id,item_id,seller_id,network_id,quote_id,attempt_commitment,beneficiary,buyer_wallet,seller_wallet,buyer_token,seller_token,treasury_token,refund_token,policy_version,total_units,net_units,fee_units,gross_cents,fee_cents,net_cents,valid_from,expires_at,permit,authorized_by,authorized_at,state,created_at INTO a.id,a.idempotency_key,a.buyer_id,a.sale_id,a.listing_id,a.card_id,a.item_id,a.seller_id,a.network_id,a.quote_id,a.attempt_commitment,a.beneficiary,a.buyer_wallet,a.seller_wallet,a.buyer_token,a.seller_token,a.treasury_token,a.refund_token,a.policy_version,a.total_units,a.net_units,a.fee_units,a.gross_cents,a.fee_cents,a.net_cents,a.valid_from,a.expires_at,a.permit,a.authorized_by,a.authorized_at,a.state,a.created_at FROM payment_v2.attempts WHERE buyer_id=u AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF a.listing_id<>p_listing_id OR a.policy_version<>p_policy_version OR NOT EXISTS(SELECT 1 FROM payment_v2.policies WHERE version=a.policy_version AND encode(digest,'hex')=p_policy_digest) THEN RAISE EXCEPTION 'PAYMENT_V2_IDEMPOTENCY_CONFLICT';END IF;
  RETURN payment_v2.attempt_status(a.id);
 END IF;
 SELECT card_id INTO v_card FROM public.listings WHERE id=p_listing_id;PERFORM payment_v2.lock_card(v_card);
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE listing_id=p_listing_id AND fence FOR UPDATE;
 PERFORM 1 FROM public.listings WHERE id=p_listing_id AND status='public' FOR UPDATE;
 IF NOT FOUND OR s.id IS NULL OR s.state<>'open' OR s.seller_id=u OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=u AND country_code='MY') THEN RAISE EXCEPTION 'PAYMENT_V2_PURCHASE_UNAVAILABLE';END IF;
 IF NOT payment_v2.owns_claim(s.card_id,s.seller_id) OR NOT EXISTS(SELECT 1 FROM public.cards WHERE id=s.card_id AND owner_id=s.seller_id AND status='active') THEN RAISE EXCEPTION 'PAYMENT_V2_OWNERSHIP_CONFLICT';END IF;
 SELECT id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units INTO n.id,n.genesis,n.program,n.config,n.mint,n.token_program,n.treasury,n.treasury_token,n.issuer,n.authority_epoch,n.policy_version,n.funding_enabled,n.max_trade_units,n.max_escrow_units FROM payment_v2.networks WHERE id=s.network_id;
 IF NOT payment_v2.funding_configuration(n.id) OR p_policy_version IS DISTINCT FROM 'MY-USDC-ESCROW-1' OR NOT n.funding_enabled OR s.policy_version<>p_policy_version OR NOT EXISTS(SELECT 1 FROM payment_v2.policies WHERE version=p_policy_version AND encode(digest,'hex')=p_policy_digest) THEN RAISE EXCEPTION 'PAYMENT_V2_POLICY_OR_FUNDING_DISABLED';END IF;
 -- Re-check after lock to make concurrent initiation exact retries return the same attempt.
 SELECT id,idempotency_key,buyer_id,sale_id,listing_id,card_id,item_id,seller_id,network_id,quote_id,attempt_commitment,beneficiary,buyer_wallet,seller_wallet,buyer_token,seller_token,treasury_token,refund_token,policy_version,total_units,net_units,fee_units,gross_cents,fee_cents,net_cents,valid_from,expires_at,permit,authorized_by,authorized_at,state,created_at INTO a.id,a.idempotency_key,a.buyer_id,a.sale_id,a.listing_id,a.card_id,a.item_id,a.seller_id,a.network_id,a.quote_id,a.attempt_commitment,a.beneficiary,a.buyer_wallet,a.seller_wallet,a.buyer_token,a.seller_token,a.treasury_token,a.refund_token,a.policy_version,a.total_units,a.net_units,a.fee_units,a.gross_cents,a.fee_cents,a.net_cents,a.valid_from,a.expires_at,a.permit,a.authorized_by,a.authorized_at,a.state,a.created_at FROM payment_v2.attempts WHERE buyer_id=u AND idempotency_key=p_idempotency_key;
 IF FOUND THEN IF a.listing_id<>p_listing_id OR a.policy_version<>p_policy_version THEN RAISE EXCEPTION 'PAYMENT_V2_IDEMPOTENCY_CONFLICT';END IF;RETURN payment_v2.attempt_status(a.id);END IF;
 SELECT id,sale_id,total_units,fx_snapshot,valid_from,expires_at,created_at INTO q.id,q.sale_id,q.total_units,q.fx_snapshot,q.valid_from,q.expires_at,q.created_at FROM payment_v2.quote_books WHERE sale_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF q.id IS NULL OR q.total_units>n.max_trade_units OR v_now<q.valid_from OR v_now>=q.expires_at THEN RAISE EXCEPTION 'PAYMENT_V2_QUOTE_EXPIRED';END IF;
 SELECT wa.user_id,wa.network_id,wa.wallet,wa.token_account,wa.proof_digest INTO w.user_id,w.network_id,w.wallet,w.token_account,w.proof_digest FROM payment_v2.wallet_accounts wa JOIN public.users x ON x.id=wa.user_id
 WHERE wa.user_id=u AND wa.network_id=n.id AND x.solana_address=payment_v2.b58(wa.wallet);
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_BUYER_WALLET_REQUIRED';END IF;
 INSERT INTO payment_v2.attempts(id,idempotency_key,buyer_id,sale_id,listing_id,card_id,item_id,seller_id,network_id,quote_id,attempt_commitment,beneficiary,buyer_wallet,seller_wallet,buyer_token,seller_token,treasury_token,refund_token,policy_version,total_units,net_units,fee_units,gross_cents,fee_cents,net_cents,valid_from,expires_at)
 VALUES(v_id,p_idempotency_key,u,s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,q.id,sha256(uuid_send(v_id)),sha256(uuid_send(u)),w.wallet,s.seller_wallet,w.token_account,s.seller_token,(s.network_snapshot).treasury_token,w.token_account,s.policy_version,q.total_units,q.total_units-floor(q.total_units*500/10000),floor(q.total_units*500/10000),s.price_cents,s.price_cents*500::bigint/10000,s.price_cents-s.price_cents*500::bigint/10000,q.valid_from,q.expires_at);
 RETURN payment_v2.attempt_status(v_id);
END $$;
CREATE FUNCTION public.fn_payment_v2_authorize_attempt(p_attempt_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a payment_v2.attempts%rowtype;s payment_v2.sales%rowtype;n payment_v2.networks%rowtype;v payment_v2.inventory%rowtype;p bytea;policy bytea;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 SELECT sale_id INTO a.sale_id FROM payment_v2.attempts WHERE id=p_attempt_id;PERFORM payment_v2.lock_sale(a.sale_id);
 SELECT id,idempotency_key,buyer_id,sale_id,listing_id,card_id,item_id,seller_id,network_id,quote_id,attempt_commitment,beneficiary,buyer_wallet,seller_wallet,buyer_token,seller_token,treasury_token,refund_token,policy_version,total_units,net_units,fee_units,gross_cents,fee_cents,net_cents,valid_from,expires_at,permit,authorized_by,authorized_at,state,created_at INTO a.id,a.idempotency_key,a.buyer_id,a.sale_id,a.listing_id,a.card_id,a.item_id,a.seller_id,a.network_id,a.quote_id,a.attempt_commitment,a.beneficiary,a.buyer_wallet,a.seller_wallet,a.buyer_token,a.seller_token,a.treasury_token,a.refund_token,a.policy_version,a.total_units,a.net_units,a.fee_units,a.gross_cents,a.fee_cents,a.net_cents,a.valid_from,a.expires_at,a.permit,a.authorized_by,a.authorized_at,a.state,a.created_at FROM payment_v2.attempts WHERE id=p_attempt_id FOR UPDATE;SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=a.sale_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_ATTEMPT_MISSING';END IF;
 IF a.permit IS NOT NULL THEN RETURN encode(a.permit,'hex');END IF;
 IF s.state<>'open' OR extract(epoch FROM now())>=a.expires_at OR NOT EXISTS(SELECT 1 FROM payment_v2.networks WHERE id=s.network_id AND funding_enabled AND payment_v2.funding_configuration(id) AND a.total_units<=max_trade_units) THEN RAISE EXCEPTION 'PAYMENT_V2_AUTHORIZATION_DISABLED';END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_v2.networks cur WHERE cur.id=s.network_id AND cur.authority_epoch=(s.network_snapshot).authority_epoch AND cur.issuer=(s.network_snapshot).issuer AND cur.policy_version=s.policy_version) THEN RAISE EXCEPTION 'PAYMENT_V2_AUTHORITY_ROTATED';END IF;
 n:=s.network_snapshot;SELECT card_id,item_id,card_commitment,pair_commitment,custody_version,generation,mode,quarantined,enrollment_evidence,enrolled_by,approved_by INTO v.card_id,v.item_id,v.card_commitment,v.pair_commitment,v.custody_version,v.generation,v.mode,v.quarantined,v.enrollment_evidence,v.enrolled_by,v.approved_by FROM payment_v2.inventory WHERE card_id=s.card_id;SELECT digest INTO policy FROM payment_v2.policies WHERE version=a.policy_version;
 p:=decode('46534f415256320002','hex')||set_byte(decode('00','hex'),0,s.mode)||n.genesis||n.program||n.config||s.sale_commitment||v.card_commitment||v.pair_commitment||a.attempt_commitment||a.beneficiary||policy||a.buyer_wallet||a.seller_wallet||n.treasury||n.mint||n.token_program||a.buyer_token||a.seller_token||a.treasury_token||a.refund_token||n.issuer||payment_v2.le64(s.generation)||payment_v2.le64(s.revision)||payment_v2.le64(s.custody_version)||payment_v2.le64(n.authority_epoch)||payment_v2.le64(a.total_units)||payment_v2.le64(a.net_units)||payment_v2.le64(a.fee_units)||payment_v2.le64(a.valid_from)||payment_v2.le64(a.expires_at);
 IF octet_length(p)<>690 THEN RAISE EXCEPTION 'PAYMENT_V2_WIRE_LENGTH';END IF;
 UPDATE payment_v2.attempts SET permit=p,state='authorized',authorized_by=session_user,authorized_at=clock_timestamp() WHERE id=a.id;RETURN encode(p,'hex');
END $$;
CREATE FUNCTION public.fn_payment_v2_own_attempts(p_listing_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(payment_v2.attempt_status(id) ORDER BY created_at),'[]'::jsonb) FROM payment_v2.attempts WHERE buyer_id=payment_v2.actor() AND listing_id=p_listing_id
$$;
CREATE FUNCTION public.fn_payment_v2_attach_candidate(p_attempt_id uuid,p_signature text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_v2.attempts WHERE id=p_attempt_id AND buyer_id=payment_v2.actor()) THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_YOUR_ATTEMPT' USING ERRCODE='42501';END IF;
 INSERT INTO payment_v2.candidates VALUES(p_attempt_id,p_signature,now()) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION public.fn_payment_v2_recovery_binding(p_attempt text,p_genesis text,p_program text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a payment_v2.attempts%rowtype;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 SELECT a0.id,a0.idempotency_key,a0.buyer_id,a0.sale_id,a0.listing_id,a0.card_id,a0.item_id,a0.seller_id,a0.network_id,a0.quote_id,a0.attempt_commitment,a0.beneficiary,a0.buyer_wallet,a0.seller_wallet,a0.buyer_token,a0.seller_token,a0.treasury_token,a0.refund_token,a0.policy_version,a0.total_units,a0.net_units,a0.fee_units,a0.gross_cents,a0.fee_cents,a0.net_cents,a0.valid_from,a0.expires_at,a0.permit,a0.authorized_by,a0.authorized_at,a0.state,a0.created_at INTO a.id,a.idempotency_key,a.buyer_id,a.sale_id,a.listing_id,a.card_id,a.item_id,a.seller_id,a.network_id,a.quote_id,a.attempt_commitment,a.beneficiary,a.buyer_wallet,a.seller_wallet,a.buyer_token,a.seller_token,a.treasury_token,a.refund_token,a.policy_version,a.total_units,a.net_units,a.fee_units,a.gross_cents,a.fee_cents,a.net_cents,a.valid_from,a.expires_at,a.permit,a.authorized_by,a.authorized_at,a.state,a.created_at FROM payment_v2.attempts a0 JOIN payment_v2.sales s ON s.id=a0.sale_id
 WHERE a0.attempt_commitment=payment_v2.unb58(p_attempt) AND (s.network_snapshot).genesis=payment_v2.unb58(p_genesis) AND (s.network_snapshot).program=payment_v2.unb58(p_program);
 IF a.permit IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_NO_AUTHORIZED_ATTEMPT';END IF;
 RETURN jsonb_build_object('permitHex',encode(a.permit,'hex'),'appliedKinds',coalesce((SELECT jsonb_agg(e.kind) FROM payment_v2.events e JOIN payment_v2.consumptions c ON c.event_id=e.id WHERE e.attempt_id=a.id),'[]'::jsonb));
END $$;
CREATE FUNCTION public.fn_payment_v2_record_verified_event(p_event jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a payment_v2.attempts%rowtype;s payment_v2.sales%rowtype;e payment_v2.events%rowtype;v_kind text:=p_event->>'kind';v_id uuid;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_verifier');
 SELECT id,idempotency_key,buyer_id,sale_id,listing_id,card_id,item_id,seller_id,network_id,quote_id,attempt_commitment,beneficiary,buyer_wallet,seller_wallet,buyer_token,seller_token,treasury_token,refund_token,policy_version,total_units,net_units,fee_units,gross_cents,fee_cents,net_cents,valid_from,expires_at,permit,authorized_by,authorized_at,state,created_at INTO a.id,a.idempotency_key,a.buyer_id,a.sale_id,a.listing_id,a.card_id,a.item_id,a.seller_id,a.network_id,a.quote_id,a.attempt_commitment,a.beneficiary,a.buyer_wallet,a.seller_wallet,a.buyer_token,a.seller_token,a.treasury_token,a.refund_token,a.policy_version,a.total_units,a.net_units,a.fee_units,a.gross_cents,a.fee_cents,a.net_cents,a.valid_from,a.expires_at,a.permit,a.authorized_by,a.authorized_at,a.state,a.created_at FROM payment_v2.attempts WHERE attempt_commitment=payment_v2.unb58(p_event->>'attempt');
 PERFORM payment_v2.lock_sale(a.sale_id);SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=a.sale_id;
 SELECT id,idempotency_key,buyer_id,sale_id,listing_id,card_id,item_id,seller_id,network_id,quote_id,attempt_commitment,beneficiary,buyer_wallet,seller_wallet,buyer_token,seller_token,treasury_token,refund_token,policy_version,total_units,net_units,fee_units,gross_cents,fee_cents,net_cents,valid_from,expires_at,permit,authorized_by,authorized_at,state,created_at INTO a.id,a.idempotency_key,a.buyer_id,a.sale_id,a.listing_id,a.card_id,a.item_id,a.seller_id,a.network_id,a.quote_id,a.attempt_commitment,a.beneficiary,a.buyer_wallet,a.seller_wallet,a.buyer_token,a.seller_token,a.treasury_token,a.refund_token,a.policy_version,a.total_units,a.net_units,a.fee_units,a.gross_cents,a.fee_cents,a.net_cents,a.valid_from,a.expires_at,a.permit,a.authorized_by,a.authorized_at,a.state,a.created_at FROM payment_v2.attempts WHERE id=a.id FOR UPDATE;
 PERFORM payment_v2.proof_shape(p_event);
 IF NOT (p_event ?& ARRAY['kind','signature','slot','fundedAtSeconds','decisionRevision','permitHex','genesis','program','sale','attempt','finality']) OR a.id IS NULL OR a.permit IS NULL OR p_event->>'finality' IS DISTINCT FROM 'finalized'
 OR decode(p_event->>'permitHex','hex') IS DISTINCT FROM a.permit
 OR payment_v2.unb58(p_event->>'genesis') IS DISTINCT FROM (s.network_snapshot).genesis
 OR payment_v2.unb58(p_event->>'program') IS DISTINCT FROM (s.network_snapshot).program
 OR payment_v2.unb58(p_event->>'sale') IS DISTINCT FROM s.sale_address
 OR (p_event->>'fundedAtSeconds')::bigint<a.valid_from OR (p_event->>'fundedAtSeconds')::bigint>=a.expires_at
 OR (s.mode=0 AND v_kind='direct') OR (s.mode=1 AND v_kind<>'direct') THEN RAISE EXCEPTION 'PAYMENT_V2_EVIDENCE_CORRESPONDENCE';END IF;
 SELECT id,attempt_id,sale_id,kind,network_id,genesis,signature,slot,funded_at,decision_revision,proof,proof_digest,verifier_login,created_at INTO e.id,e.attempt_id,e.sale_id,e.kind,e.network_id,e.genesis,e.signature,e.slot,e.funded_at,e.decision_revision,e.proof,e.proof_digest,e.verifier_login,e.created_at FROM payment_v2.events WHERE (sale_id=s.id AND (events.kind=v_kind OR (events.kind IN('funded','direct') AND v_kind IN('funded','direct')) OR (events.kind IN('released','refunded') AND v_kind IN('released','refunded')))) OR (genesis=(s.network_snapshot).genesis AND signature=p_event->>'signature') FOR UPDATE;
 IF FOUND THEN
  IF e.attempt_id<>a.id OR e.sale_id<>s.id OR e.kind<>v_kind OR e.proof IS DISTINCT FROM p_event THEN RAISE EXCEPTION 'PAYMENT_V2_CONFLICTING_EVIDENCE';END IF;RETURN e.id;
 END IF;
 INSERT INTO payment_v2.events(attempt_id,sale_id,kind,network_id,genesis,signature,slot,funded_at,decision_revision,proof,proof_digest,verifier_login)
 VALUES(a.id,s.id,v_kind,s.network_id,(s.network_snapshot).genesis,p_event->>'signature',(p_event->>'slot')::bigint,(p_event->>'fundedAtSeconds')::bigint,(p_event->>'decisionRevision')::numeric,p_event,sha256(convert_to(p_event::text,'UTF8')),session_user) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
DO $seal$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'fn_payment_v2_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);END LOOP;END $seal$;
COMMIT;
