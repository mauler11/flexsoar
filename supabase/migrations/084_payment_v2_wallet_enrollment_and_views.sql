-- 084: payment-v2 wallet enrollment, seller signing view, funding-gate projection and issuer open-sale reader.
-- Additive only. One transaction; no existing payment function body or ACL is changed.
BEGIN;

DO $role$
BEGIN
 IF NOT pg_has_role(current_user,'payment_v2_owner','SET') OR NOT pg_has_role(current_user,'payment_v2_owner','USAGE') THEN
  RAISE EXCEPTION '084: % cannot SET ROLE / inherit payment_v2_owner; run as the role that applied 059-083',current_user;
 END IF;
END $role$;

CREATE TEMP TABLE m084_before ON COMMIT DROP AS
 SELECT p.oid,p.oid::regprocedure::text AS sig,md5(replace(p.prosrc,chr(13),'')) AS body,p.proowner,p.proacl,p.prosecdef,p.proconfig
 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='payment_v2' OR (ns.nspname='public' AND p.proname LIKE 'fn\_payment\_v2\_%');

DO $preguard$
BEGIN
 IF to_regclass('payment_v2.governance_mode') IS NULL OR to_regclass('payment_v2.sale_listings') IS NULL
  OR to_regclass('payment_v2.listing_policy') IS NULL THEN RAISE EXCEPTION '084: 082 and 083 are not applied';END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION '084: funding must be disabled on every network';END IF;
 IF has_schema_privilege('payment_v2_owner','public','CREATE') THEN RAISE EXCEPTION '084: payment_v2_owner already has CREATE on public; inspect first';END IF;
 IF to_regprocedure('public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_listing_view(uuid)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_governance_projection()') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_open_sale_queue(integer)') IS NOT NULL THEN
  RAISE EXCEPTION '084: one or more wallet/view RPCs already exist';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='payment_v2.wallet_accounts'::regclass AND tgname='immutable' AND NOT tgisinternal) THEN
  RAISE EXCEPTION '084: wallet_accounts immutability trigger is missing';
 END IF;
 IF (SELECT count(*) FROM payment_v2.governance_mode)<>1 THEN RAISE EXCEPTION '084: governance_mode is not a singleton';END IF;
END $preguard$;

-- The only wallet writer. SQL verifies identity and uniqueness but cannot verify Ed25519 or an ATA's chain state.
CREATE FUNCTION public.fn_payment_v2_enroll_wallet(p_user uuid,p_network uuid,p_wallet bytea,p_token_account bytea,p_proof_digest bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_country text;v_address text;v_existing payment_v2.wallet_accounts%rowtype;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 SELECT country_code,solana_address INTO v_country,v_address FROM public.users WHERE id=p_user;
 IF NOT FOUND OR v_country IS DISTINCT FROM 'MY' THEN RAISE EXCEPTION 'PAYMENT_V2_WALLET_USER_NOT_MY';END IF;
 IF v_address IS DISTINCT FROM payment_v2.b58(p_wallet) THEN RAISE EXCEPTION 'PAYMENT_V2_WALLET_ADDRESS_MISMATCH';END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_v2.networks WHERE id=p_network) THEN RAISE EXCEPTION 'PAYMENT_V2_WALLET_NETWORK_UNKNOWN';END IF;
 IF p_wallet IS NULL OR octet_length(p_wallet)<>32 OR p_token_account IS NULL OR octet_length(p_token_account)<>32
  OR p_proof_digest IS NULL OR octet_length(p_proof_digest)<>32 THEN RAISE EXCEPTION 'PAYMENT_V2_WALLET_MALFORMED';END IF;
 SELECT user_id,network_id,wallet,token_account,proof_digest INTO v_existing.user_id,v_existing.network_id,v_existing.wallet,v_existing.token_account,v_existing.proof_digest
  FROM payment_v2.wallet_accounts WHERE user_id=p_user AND network_id=p_network AND wallet=p_wallet;
 IF FOUND THEN
  IF v_existing.token_account=p_token_account AND v_existing.proof_digest=p_proof_digest THEN RETURN;END IF;
  RAISE EXCEPTION 'PAYMENT_V2_WALLET_ENROLLMENT_CONFLICT';
 END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.wallet_accounts WHERE network_id=p_network AND token_account=p_token_account) THEN
  RAISE EXCEPTION 'PAYMENT_V2_WALLET_TOKEN_ACCOUNT_USED';
 END IF;
 INSERT INTO payment_v2.wallet_accounts(user_id,network_id,wallet,token_account,proof_digest)
 VALUES(p_user,p_network,p_wallet,p_token_account,p_proof_digest) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN
  SELECT user_id,network_id,wallet,token_account,proof_digest INTO v_existing.user_id,v_existing.network_id,v_existing.wallet,v_existing.token_account,v_existing.proof_digest
   FROM payment_v2.wallet_accounts WHERE user_id=p_user AND network_id=p_network AND wallet=p_wallet;
  IF FOUND AND v_existing.token_account=p_token_account AND v_existing.proof_digest=p_proof_digest THEN RETURN;END IF;
  IF EXISTS(SELECT 1 FROM payment_v2.wallet_accounts WHERE network_id=p_network AND token_account=p_token_account) THEN
   RAISE EXCEPTION 'PAYMENT_V2_WALLET_TOKEN_ACCOUNT_USED';
  END IF;
  RAISE EXCEPTION 'PAYMENT_V2_WALLET_ENROLLMENT_CONFLICT';
 END IF;
END $$;

-- Returns only signing inputs for the authenticated seller's own currently prepared sale.
CREATE FUNCTION public.fn_payment_v2_listing_view(p_listing uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=payment_v2.actor();r record;
BEGIN
 SELECT s.id AS sale_id,s.listing_id,s.card_id,s.sale_commitment,s.generation,n.genesis,n.program,
        i.card_commitment,q.total_units,q.valid_from,q.expires_at,p.tolerance_bps
 INTO r
 FROM payment_v2.sales s
 JOIN payment_v2.networks n ON n.id=s.network_id
 JOIN payment_v2.inventory i ON i.card_id=s.card_id
 JOIN payment_v2.listing_policy p ON true
 JOIN LATERAL (SELECT total_units,valid_from,expires_at FROM payment_v2.quote_books WHERE sale_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) q ON true
 WHERE s.listing_id=p_listing AND s.seller_id=u AND s.state='opening' AND s.fence;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_NOT_YOURS';END IF;
 RETURN jsonb_build_object('saleId',r.sale_id,'listingId',r.listing_id,'cardId',r.card_id,
  'cardCommitment',payment_v2.b58(r.card_commitment),'saleCommitment',payment_v2.b58(r.sale_commitment),
  'generation',r.generation::text,'genesis',payment_v2.b58(r.genesis),'program',payment_v2.b58(r.program),
  'quoteTotalUnits',r.total_units::text,'quoteValidFrom',r.valid_from::text,'quoteExpiresAt',r.expires_at::text,
  'toleranceBps',r.tolerance_bps);
END $$;

-- Exact three-column projection consumed by parseGovernanceModeRows in the funding gate.
CREATE FUNCTION public.fn_payment_v2_governance_projection()
RETURNS TABLE(operational_separation text,governors_required integer,release_delay_seconds integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT g.operational_separation,g.governors_required::integer,g.release_delay_seconds
 FROM payment_v2.governance_mode g
$$;

-- Issuer-only, read-only queue. The issuer serializes work in its single supervised process,
-- checks the chain before retrying, and obtains the seller bytes from listing_for_open.
CREATE FUNCTION public.fn_payment_v2_open_sale_queue(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'PAYMENT_V2_OPEN_SALE_LIMIT';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('operationId',o.id,'saleId',s.id,'saleAddress',payment_v2.b58(s.sale_address),
   'escrowAddress',payment_v2.b58(s.escrow_address),'saleCommitment',payment_v2.b58(s.sale_commitment),
   'generation',s.generation::text,'cardId',s.card_id,'cardCommitment',payment_v2.b58(i.card_commitment),
   'pairCommitment',payment_v2.b58(i.pair_commitment),'sellerWallet',payment_v2.b58(s.seller_wallet),
   'mode',s.mode,'network',jsonb_build_object('genesis',payment_v2.b58((s.network_snapshot).genesis),
   'program',payment_v2.b58((s.network_snapshot).program),'config',payment_v2.b58((s.network_snapshot).config),
   'issuer',payment_v2.b58((s.network_snapshot).issuer))) ORDER BY o.created_at,o.id),'[]'::jsonb)
 INTO r
 FROM (SELECT id,sale_id,created_at FROM payment_v2.operations WHERE action='open_sale' AND ready AND state<>'observed'
       ORDER BY created_at,id LIMIT p_limit) o
 JOIN payment_v2.sales s ON s.id=o.sale_id AND s.state='opening' AND s.fence
 JOIN payment_v2.inventory i ON i.card_id=s.card_id
 JOIN payment_v2.sale_listings l ON l.sale_id=s.id;
 RETURN r;
END $$;

-- Transfer ownership under the same temporary public-schema CREATE bracket used by 083.
GRANT CREATE ON SCHEMA public TO payment_v2_owner;
DO $owner$ DECLARE f text;BEGIN
 FOREACH f IN ARRAY ARRAY[
  'public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)',
  'public.fn_payment_v2_listing_view(uuid)',
  'public.fn_payment_v2_governance_projection()',
  'public.fn_payment_v2_open_sale_queue(integer)'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO payment_v2_owner',f);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier',f);
 END LOOP;
END $owner$;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea) TO payment_v2_issuer;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_listing_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_governance_projection() TO payment_v2_verifier;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_open_sale_queue(integer) TO payment_v2_issuer;
REVOKE CREATE ON SCHEMA public FROM payment_v2_owner;

DO $postguard$
DECLARE r record;
BEGIN
 FOR r IN SELECT b.sig FROM m084_before b JOIN pg_proc p ON p.oid=b.oid
  WHERE md5(replace(p.prosrc,chr(13),''))<>b.body OR p.proowner<>b.proowner OR p.proacl IS DISTINCT FROM b.proacl
   OR p.prosecdef<>b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig LOOP
  RAISE EXCEPTION '084: pre-existing function % changed',r.sig;
 END LOOP;
 IF EXISTS(SELECT 1 FROM m084_before b WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=b.oid)) THEN
  RAISE EXCEPTION '084: a pre-existing function disappeared';END IF;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.proname LIKE 'fn\_payment\_v2\_%' AND p.oid NOT IN(SELECT oid FROM m084_before))<>4 THEN
  RAISE EXCEPTION '084: expected exactly 4 new public functions';END IF;
 IF has_schema_privilege('payment_v2_owner','public','CREATE') THEN RAISE EXCEPTION '084: payment_v2_owner still holds CREATE on public';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN(
  'public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)'::regprocedure,
  'public.fn_payment_v2_listing_view(uuid)'::regprocedure,
  'public.fn_payment_v2_governance_projection()'::regprocedure,
  'public.fn_payment_v2_open_sale_queue(integer)'::regprocedure)
  AND (p.proowner<>'payment_v2_owner'::regrole OR NOT p.prosecdef
   OR has_function_privilege('anon',p.oid,'EXECUTE')
   OR has_function_privilege('service_role',p.oid,'EXECUTE'))) THEN
  RAISE EXCEPTION '084: new RPC ownership or public ACL is wrong';END IF;
 FOR r IN
  SELECT x.role_name,f.sig,f.allowed_role FROM unnest(ARRAY['anon','authenticated','service_role','payment_v2_issuer',
   'payment_v2_verifier','payment_v2_settler','payment_v2_executor','payment_v2_notifier']) x(role_name)
  CROSS JOIN (VALUES
   ('public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)'::regprocedure,'payment_v2_issuer'),
   ('public.fn_payment_v2_listing_view(uuid)'::regprocedure,'authenticated'),
   ('public.fn_payment_v2_governance_projection()'::regprocedure,'payment_v2_verifier'),
   ('public.fn_payment_v2_open_sale_queue(integer)'::regprocedure,'payment_v2_issuer')) f(sig,allowed_role)
 LOOP
  IF has_function_privilege(r.role_name,r.sig,'EXECUTE') IS DISTINCT FROM (r.role_name=r.allowed_role) THEN
   RAISE EXCEPTION '084: unexpected EXECUTE privilege for % on %',r.role_name,r.sig;
  END IF;
 END LOOP;
END $postguard$;

COMMIT;
