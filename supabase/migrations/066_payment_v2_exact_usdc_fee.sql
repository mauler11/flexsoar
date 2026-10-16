-- Forward repair: exact USDC fee only; MYR bigint arithmetic is unchanged.
BEGIN;
LOCK TABLE payment_v2.attempts IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE payment_fee_function_before ON COMMIT DROP AS
 SELECT oid,to_jsonb(p)-'prosrc' AS metadata,prosrc FROM pg_proc p WHERE oid='public.fn_payment_v2_initiate(uuid,uuid,text,text)'::regprocedure;
CREATE TEMP TABLE payment_fee_expected_shape(total_units payment_v2.u64,net_units payment_v2.u64,fee_units payment_v2.u64,CONSTRAINT expected_allocation CHECK(total_units>0 AND net_units+fee_units=total_units AND fee_units=floor(total_units*500/10000))) ON COMMIT DROP;
CREATE TEMP TABLE payment_fee_constraint_before ON COMMIT DROP AS
 SELECT oid,conname,pg_get_constraintdef(oid) AS definition,connoinherit,obj_description(oid,'pg_constraint') AS description
 FROM pg_constraint WHERE conrelid='payment_v2.attempts'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%fee_units%floor(%';
CREATE TEMP TABLE payment_fee_other_constraints_before ON COMMIT DROP AS
 SELECT oid,to_jsonb(c) AS metadata FROM pg_constraint c WHERE conrelid='payment_v2.attempts'::regclass AND oid NOT IN(SELECT oid FROM payment_fee_constraint_before);
DO $preflight$ DECLARE c record;BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_fee_function_before WHERE encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex')='5531e239649c96d0dcadc5e07a83fd2ab7c718a51ddbf3f64d173b3e8d873020') THEN RAISE EXCEPTION 'unexpected original function body: review catalog';END IF;
 IF (SELECT count(*) FROM payment_fee_constraint_before)<>1 THEN RAISE EXCEPTION 'expected one rounded USDC allocation constraint: review catalog';END IF;
 SELECT conname,definition,connoinherit,description INTO c FROM payment_fee_constraint_before;
 IF c.definition IS DISTINCT FROM (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='pg_temp.payment_fee_expected_shape'::regclass AND conname='expected_allocation') THEN RAISE EXCEPTION 'unexpected fee constraint definition';END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.attempts WHERE fee_units IS DISTINCT FROM pg_catalog.div(total_units*500::numeric,10000::numeric)
 OR net_units IS DISTINCT FROM total_units-pg_catalog.div(total_units*500::numeric,10000::numeric)) THEN RAISE EXCEPTION 'affected persisted attempts: inspect and report; never silently rewrite';END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_fee_function_before WHERE prosrc LIKE '%floor(q.total_units*500/10000)%') THEN RAISE EXCEPTION 'unexpected initiation allocation';END IF;
 EXECUTE format('ALTER TABLE payment_v2.attempts DROP CONSTRAINT %I',c.conname);
 EXECUTE format('ALTER TABLE payment_v2.attempts ADD CONSTRAINT %I CHECK(total_units>0 AND net_units+fee_units=total_units AND fee_units=pg_catalog.div(total_units*500::numeric,10000::numeric))%s',c.conname,CASE WHEN c.connoinherit THEN ' NO INHERIT' ELSE '' END);
 IF c.description IS NOT NULL THEN EXECUTE format('COMMENT ON CONSTRAINT %I ON payment_v2.attempts IS %L',c.conname,c.description);END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.fn_payment_v2_initiate(p_listing_id uuid,p_idempotency_key uuid,p_policy_version text,p_policy_digest text) RETURNS jsonb
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
 VALUES(v_id,p_idempotency_key,u,s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,q.id,sha256(uuid_send(v_id)),sha256(uuid_send(u)),w.wallet,s.seller_wallet,w.token_account,s.seller_token,(s.network_snapshot).treasury_token,w.token_account,s.policy_version,q.total_units,q.total_units-pg_catalog.div(q.total_units*500::numeric,10000::numeric),pg_catalog.div(q.total_units*500::numeric,10000::numeric),s.price_cents,s.price_cents*500::bigint/10000,s.price_cents-s.price_cents*500::bigint/10000,q.valid_from,q.expires_at);
 RETURN payment_v2.attempt_status(v_id);
END $$;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM payment_fee_function_before b JOIN pg_proc p ON p.oid=b.oid WHERE b.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc' OR replace(b.prosrc,'floor(q.total_units*500/10000)','pg_catalog.div(q.total_units*500::numeric,10000::numeric)') IS DISTINCT FROM p.prosrc) THEN RAISE EXCEPTION 'initiate changed beyond exact USDC quotients';END IF;
 IF EXISTS(SELECT oid,metadata FROM payment_fee_other_constraints_before EXCEPT SELECT oid,to_jsonb(c) FROM pg_constraint c WHERE conrelid='payment_v2.attempts'::regclass)
 OR EXISTS(SELECT 1 FROM payment_fee_constraint_before b LEFT JOIN pg_constraint c ON c.conname=b.conname AND c.conrelid='payment_v2.attempts'::regclass WHERE c.oid IS NULL OR NOT c.convalidated) THEN RAISE EXCEPTION 'constraint preservation/validation failed';END IF;
END $postflight$;
COMMIT;
