-- 086: issuer subject reader, checked enrollment, HMAC nonce registry and fenced open-sale leases.
-- Forward-only, one transaction. Replay only in the isolated payment-v2 test container.
BEGIN;

CREATE TEMP TABLE m086_before ON COMMIT DROP AS
 SELECT p.oid,p.oid::regprocedure::text AS sig,md5(replace(p.prosrc,chr(13),'')) AS body,
        p.proowner,p.proacl,p.prosecdef,p.proconfig
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='payment_v2' OR (n.nspname='public' AND p.proname LIKE 'fn\_payment\_v2\_%');
CREATE TEMP TABLE m086_operation_guard_before ON COMMIT DROP AS
 SELECT t.oid,t.tgname,t.tgenabled,t.tgtype,t.tgfoid,t.tgargs,t.tgqual
 FROM pg_trigger t WHERE t.tgrelid='payment_v2.operations'::regclass AND t.tgname='immutable_terms' AND NOT t.tgisinternal;

DO $pre$
BEGIN
 IF NOT pg_has_role(current_user,'payment_v2_owner','SET') OR NOT pg_has_role(current_user,'payment_v2_owner','USAGE') THEN
  RAISE EXCEPTION 'PAYMENT_V2_ISSUER_MIGRATION_ROLE'; END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION 'PAYMENT_V2_FUNDING_ENABLED'; END IF;
 IF to_regclass('payment_v2.issuer_hmac_keys') IS NOT NULL OR to_regclass('payment_v2.issuer_hmac_key_events') IS NOT NULL
  OR to_regclass('payment_v2.issuer_hmac_nonces') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='payment_v2.operations'::regclass AND attname='issuer_fencing_token' AND NOT attisdropped)
  OR to_regprocedure('public.fn_payment_v2_issuer_subject_context(text,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_issuer_enroll_wallet_checked(uuid,uuid,bytea,bytea,bytea)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_consume_issuer_nonce(text,bytea)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_claim_open_sale(integer)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_renew_open_sale_lease(uuid,uuid,bigint)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_finish_open_sale(uuid,uuid,bigint,text,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'PAYMENT_V2_ISSUER_086_ALREADY_APPLIED'; END IF;
 IF has_schema_privilege('payment_v2_owner','public','CREATE') THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_OWNER_PUBLIC_CREATE'; END IF;
 IF to_regclass('payment_v2.sale_listings') IS NULL OR to_regclass('payment_v2.listing_policy') IS NULL
  OR to_regprocedure('public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)') IS NULL THEN
  RAISE EXCEPTION 'PAYMENT_V2_ISSUER_085_REQUIRED'; END IF;
 IF (SELECT count(*) FROM m086_operation_guard_before)<>1 OR NOT EXISTS(SELECT 1 FROM m086_operation_guard_before WHERE tgfoid='payment_v2.terms_guard()'::regprocedure AND tgenabled='O' AND tgtype=19) THEN
  RAISE EXCEPTION 'PAYMENT_V2_ISSUER_OPERATION_TERMS_GUARD_DRIFT'; END IF;
END $pre$;

ALTER TABLE payment_v2.operations ADD COLUMN issuer_fencing_token bigint NOT NULL DEFAULT 0;
ALTER TABLE payment_v2.operations ADD CONSTRAINT operations_issuer_fence_nonnegative CHECK(issuer_fencing_token>=0);

-- 063/065's whole-row immutable terms guard predates the mutable lease fence.
-- Keep that frozen function body unchanged and replace only the operations trigger
-- attachment with a byte-for-byte equivalent guard that excludes this new field.
SET LOCAL ROLE payment_v2_owner;
CREATE FUNCTION payment_v2.operations_terms_guard_086() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE excluded text[];
BEGIN
 excluded:=ARRAY['state','ready','lease_id','leased_by','worker_id','lease_until','attempts','signature','resolved_event','last_error','available_at','issuer_fencing_token'];
 IF (to_jsonb(NEW)-excluded) IS DISTINCT FROM (to_jsonb(OLD)-excluded) THEN RAISE EXCEPTION 'PAYMENT_V2_TERMS_IMMUTABLE'; END IF;
 IF NEW.resolved_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_v2.events WHERE id=NEW.resolved_event AND sale_id=NEW.sale_id) THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_RESOLUTION_CONFLICT'; END IF;
 IF OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_IDENTITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION payment_v2.operations_terms_guard_086() FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
RESET ROLE;
DROP TRIGGER immutable_terms ON payment_v2.operations;
CREATE TRIGGER immutable_terms BEFORE UPDATE ON payment_v2.operations FOR EACH ROW EXECUTE FUNCTION payment_v2.operations_terms_guard_086();

SET LOCAL ROLE payment_v2_owner;
CREATE TABLE payment_v2.issuer_hmac_keys(
 kid text PRIMARY KEY CHECK(kid ~ '^[A-Za-z0-9._-]{1,64}$'),
 fingerprint bytea NOT NULL UNIQUE CHECK(octet_length(fingerprint)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by name NOT NULL DEFAULT session_user
);
CREATE TABLE payment_v2.issuer_hmac_key_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kid text NOT NULL REFERENCES payment_v2.issuer_hmac_keys(kid),
 event text NOT NULL CHECK(event IN('staged','activated','retired','emergency-revoked')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), actor name NOT NULL DEFAULT session_user,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500)
);
CREATE TABLE payment_v2.issuer_hmac_nonces(
 kid text NOT NULL REFERENCES payment_v2.issuer_hmac_keys(kid), nonce bytea NOT NULL CHECK(octet_length(nonce)=16),
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 PRIMARY KEY(kid,nonce), CHECK(expires_at>consumed_at)
);
ALTER TABLE payment_v2.issuer_hmac_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_v2.issuer_hmac_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_v2.issuer_hmac_key_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_v2.issuer_hmac_key_events FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_v2.issuer_hmac_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_v2.issuer_hmac_nonces FORCE ROW LEVEL SECURITY;
CREATE POLICY issuer_hmac_keys_owner ON payment_v2.issuer_hmac_keys USING(current_user='payment_v2_owner') WITH CHECK(current_user='payment_v2_owner');
CREATE POLICY issuer_hmac_key_events_owner ON payment_v2.issuer_hmac_key_events USING(current_user='payment_v2_owner') WITH CHECK(current_user='payment_v2_owner');
CREATE POLICY issuer_hmac_nonces_owner ON payment_v2.issuer_hmac_nonces USING(current_user='payment_v2_owner') WITH CHECK(current_user='payment_v2_owner');
CREATE TRIGGER issuer_hmac_keys_immutable BEFORE UPDATE OR DELETE ON payment_v2.issuer_hmac_keys FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE TRIGGER issuer_hmac_events_immutable BEFORE UPDATE OR DELETE ON payment_v2.issuer_hmac_key_events FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE FUNCTION payment_v2.guard_issuer_hmac_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior text;active_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(860086);
 IF session_user<>'supabase_admin' AND session_user<>'postgres' THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_KEY_OWNER_ONLY'; END IF;
 SELECT event INTO prior FROM payment_v2.issuer_hmac_key_events WHERE kid=NEW.kid ORDER BY id DESC LIMIT 1;
 IF prior IS NULL AND NEW.event<>'staged' THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_KEY_LIFECYCLE'; END IF;
 IF prior='staged' AND NEW.event NOT IN('activated','emergency-revoked') OR prior='activated' AND NEW.event NOT IN('retired','emergency-revoked') OR prior='retired' AND NEW.event<>'emergency-revoked' OR prior='emergency-revoked' THEN
  RAISE EXCEPTION 'PAYMENT_V2_ISSUER_KEY_LIFECYCLE'; END IF;
 SELECT count(*) INTO active_count FROM (
  SELECT DISTINCT ON(kid) kid,event FROM payment_v2.issuer_hmac_key_events ORDER BY kid,id DESC
 ) x WHERE event='activated';
 IF NEW.event='activated' AND active_count<>0 THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_KEY_LIFECYCLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER issuer_hmac_event_guard BEFORE INSERT ON payment_v2.issuer_hmac_key_events FOR EACH ROW EXECUTE FUNCTION payment_v2.guard_issuer_hmac_event();
REVOKE ALL ON payment_v2.issuer_hmac_keys,payment_v2.issuer_hmac_key_events,payment_v2.issuer_hmac_nonces FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
REVOKE ALL ON SEQUENCE payment_v2.issuer_hmac_key_events_id_seq FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
RESET ROLE;

ALTER TABLE payment_v2.operations ADD CONSTRAINT operations_issuer_lease_shape CHECK(
 action<>'open_sale' OR
 (((lease_id IS NULL AND leased_by IS NULL AND lease_until IS NULL) OR
   (lease_id IS NOT NULL AND leased_by IS NOT NULL AND length(leased_by::text)>0 AND lease_until IS NOT NULL))
  AND ((state='leased')=(lease_id IS NOT NULL))));

CREATE FUNCTION public.fn_payment_v2_issuer_subject_context(p_kind text,p_subject_id uuid,p_network_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;out_json jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 IF p_kind IS NULL OR p_kind NOT IN('network','listing','sale','attempt','prepare_recovery') THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_KIND_UNSUPPORTED'; END IF;
 IF (p_kind='network' AND (p_subject_id IS NOT NULL OR p_network_id IS NULL))
  OR (p_kind='listing' AND (p_subject_id IS NULL OR p_network_id IS NULL))
  OR (p_kind IN('sale','attempt','prepare_recovery') AND (p_subject_id IS NULL OR p_network_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'PAYMENT_V2_ISSUER_NULLABILITY'; END IF;
 IF p_kind='network' THEN
  SELECT n.* INTO r FROM payment_v2.networks n WHERE n.id=p_network_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SUBJECT_MISSING'; END IF;
  RETURN jsonb_build_object('found',true,'networkId',r.id,'genesis',payment_v2.b58(r.genesis),'mint',payment_v2.b58(r.mint),'tokenProgram',payment_v2.b58(r.token_program),'associatedTokenProgram','ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL','fundingEnabled',r.funding_enabled);
 ELSIF p_kind='listing' THEN
  SELECT l.id,l.card_id,l.price_cents,l.status,l.seller_id,c.status AS card_status,i.mode,i.quarantined,
   n.id AS network_id,n.genesis,n.program,n.config,n.mint,n.token_program,n.issuer,n.funding_enabled,
   u.id AS owner_id,u.auth_id AS owner_auth_id,
   EXISTS(SELECT 1 FROM payment_v2.sales s WHERE s.listing_id=l.id AND s.fence) AS sale_fenced
  INTO r FROM public.listings l JOIN public.cards c ON c.id=l.card_id JOIN payment_v2.inventory i ON i.card_id=c.id
   JOIN payment_v2.networks n ON n.id=p_network_id JOIN public.users u ON u.id=l.seller_id
  WHERE l.id=p_subject_id AND u.auth_id IS NOT DISTINCT FROM u.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SUBJECT_MISSING'; END IF;
  RETURN jsonb_build_object('found',true,'listingId',r.id,'ownerId',r.owner_id,'ownerAuthId',r.owner_auth_id,'listingStatus',r.status,'cardId',r.card_id,'cardStatus',r.card_status,'priceCents',r.price_cents,'inventoryRegistered',true,'saleFenced',r.sale_fenced,'networkId',r.network_id,'genesis',payment_v2.b58(r.genesis),'program',payment_v2.b58(r.program),'config',payment_v2.b58(r.config),'mint',payment_v2.b58(r.mint),'tokenProgram',payment_v2.b58(r.token_program),'fundingEnabled',r.funding_enabled);
 ELSIF p_kind='sale' OR p_kind='prepare_recovery' THEN
  SELECT s.*,n.genesis,n.program,n.config,n.mint,n.token_program,n.issuer,u.id AS owner_id,u.auth_id AS owner_auth_id,
   q.total_units,q.fx_snapshot,q.valid_from,q.expires_at,q.created_at AS prepared_at,lp.tolerance_bps
  INTO r FROM payment_v2.sales s JOIN payment_v2.networks n ON n.id=s.network_id
   JOIN public.users u ON u.id=s.seller_id
   JOIN payment_v2.listing_policy lp ON true
   LEFT JOIN LATERAL(SELECT qb.total_units,qb.fx_snapshot,qb.valid_from,qb.expires_at,qb.created_at FROM payment_v2.quote_books qb WHERE qb.sale_id=s.id ORDER BY qb.created_at DESC,qb.id DESC LIMIT 1) q ON true
  WHERE s.id=p_subject_id AND u.auth_id IS NOT DISTINCT FROM u.id
   AND (p_kind<>'prepare_recovery' OR s.issuer_terms->>'id'=p_subject_id::text);
  IF NOT FOUND THEN IF p_kind='prepare_recovery' THEN RETURN jsonb_build_object('found',false); END IF; RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SUBJECT_MISSING'; END IF;
   IF r.id IS NULL OR r.listing_id IS NULL OR r.owner_id IS NULL OR r.owner_auth_id IS NULL OR r.card_id IS NULL OR r.network_id IS NULL
    OR r.state IS NULL OR r.seller_wallet IS NULL OR r.genesis IS NULL OR r.program IS NULL OR r.config IS NULL OR r.mint IS NULL
    OR r.token_program IS NULL OR r.issuer IS NULL OR r.total_units IS NULL OR r.fx_snapshot IS NULL OR r.valid_from IS NULL
    OR r.expires_at IS NULL OR r.prepared_at IS NULL OR r.tolerance_bps IS NULL OR r.issuer_terms IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SUBJECT_MISSING'; END IF;
  out_json:=jsonb_build_object('found',true,'saleId',r.id,'listingId',r.listing_id,'ownerId',r.owner_id,'ownerAuthId',r.owner_auth_id,'cardId',r.card_id,'networkId',r.network_id,'state',r.state,'sellerWallet',payment_v2.b58(r.seller_wallet),'quoteTotalUnits',r.total_units::text,'quoteValidFrom',r.valid_from::text,'quoteExpiresAt',r.expires_at::text,'toleranceBps',r.tolerance_bps,'preparedAt',r.prepared_at,'fxSnapshot',r.fx_snapshot,'issuerTerms',r.issuer_terms);
  RETURN out_json;
 ELSIF p_kind='attempt' THEN
  SELECT a.*,s.state AS sale_state,s.fence,s.network_id,n.genesis,n.program,n.config,n.mint,n.token_program,n.issuer,
   u.id AS owner_id,u.auth_id AS owner_auth_id
  INTO r FROM payment_v2.attempts a JOIN payment_v2.sales s ON s.id=a.sale_id
   JOIN payment_v2.networks n ON n.id=s.network_id JOIN public.users u ON u.id=a.buyer_id
  WHERE a.id=p_subject_id AND u.auth_id IS NOT DISTINCT FROM u.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SUBJECT_MISSING'; END IF;
  RETURN jsonb_build_object('found',true,'attemptId',r.id,'ownerId',r.owner_id,'ownerAuthId',r.owner_auth_id,'saleId',r.sale_id,'networkId',r.network_id,'state',r.state,'expiresAt',r.expires_at::text,'permitHex',CASE WHEN r.permit IS NULL THEN NULL ELSE encode(r.permit,'hex') END);
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.fn_payment_v2_issuer_enroll_wallet_checked(p_user uuid,p_network uuid,p_wallet bytea,p_token_account bytea,p_proof_digest bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 IF p_user IS NULL OR NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=p_user AND u.auth_id IS NOT DISTINCT FROM p_user) THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_IDENTITY_MISMATCH'; END IF;
 PERFORM public.fn_payment_v2_enroll_wallet(p_user,p_network,p_wallet,p_token_account,p_proof_digest);
END $$;

CREATE FUNCTION public.fn_payment_v2_consume_issuer_nonce(p_kid text,p_nonce bytea) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_now timestamptz:=clock_timestamp();active_kid text;active_count integer;v_exp timestamptz;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 IF p_kid IS NULL OR p_nonce IS NULL OR octet_length(p_nonce)<>16 THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_NONCE_MALFORMED'; END IF;
 PERFORM pg_advisory_xact_lock(860086);
  SELECT count(*) INTO active_count FROM (
   SELECT DISTINCT ON(e.kid) e.kid,e.event FROM payment_v2.issuer_hmac_key_events e ORDER BY e.kid,e.id DESC
  ) latest WHERE latest.event='activated';
  IF active_count<>1 THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_KEY_STATE_INVALID'; END IF;
  SELECT latest.kid INTO active_kid FROM (
   SELECT DISTINCT ON(e.kid) e.kid,e.event FROM payment_v2.issuer_hmac_key_events e ORDER BY e.kid,e.id DESC
  ) latest WHERE latest.event='activated';
 IF active_kid IS DISTINCT FROM p_kid THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_KEY_INACTIVE'; END IF;
 v_exp:=v_now+interval '10 minutes';
 INSERT INTO payment_v2.issuer_hmac_nonces(kid,nonce,consumed_at,expires_at) VALUES(p_kid,p_nonce,v_now,v_exp);
 RETURN v_exp;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_NONCE_REPLAY';
END $$;

CREATE FUNCTION public.fn_payment_v2_claim_open_sale(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_now timestamptz:=clock_timestamp();op record;s payment_v2.sales%rowtype;l payment_v2.sale_listings%rowtype;v_lease uuid;v_token bigint;out_json jsonb:='[]'::jsonb;one jsonb;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'PAYMENT_V2_OPEN_SALE_LIMIT'; END IF;
 FOR op IN SELECT o.id,o.sale_id,o.issuer_fencing_token FROM payment_v2.operations o
  WHERE o.action='open_sale' AND o.ready AND o.state IN('pending','unknown','submitted') AND o.available_at<=v_now
   AND (o.lease_until IS NULL OR o.lease_until<=v_now)
   AND EXISTS(SELECT 1 FROM payment_v2.sales x
    JOIN payment_v2.sale_listings y ON y.sale_id=x.id
    JOIN payment_v2.networks n ON n.id=x.network_id AND n.funding_enabled
    JOIN payment_v2.inventory i ON i.card_id=x.card_id AND i.item_id=x.item_id AND NOT i.quarantined
    JOIN public.listings pl ON pl.id=x.listing_id AND pl.card_id=x.card_id AND pl.seller_id=x.seller_id
    JOIN payment_v2.wallet_accounts wa ON wa.user_id=x.seller_id AND wa.network_id=x.network_id AND wa.wallet=x.seller_wallet AND wa.token_account=x.seller_token
    WHERE x.id=o.sale_id AND x.state='opening' AND x.fence AND y.expires_at>extract(epoch FROM v_now)
     AND (x.network_snapshot).genesis=n.genesis AND (x.network_snapshot).program=n.program
     AND (x.network_snapshot).config=n.config AND (x.network_snapshot).mint=n.mint
     AND (x.network_snapshot).token_program=n.token_program AND (x.network_snapshot).issuer=n.issuer
     AND y.min_total_units>0 AND y.binding=substring(y.message FROM 14 FOR 32))
  ORDER BY o.created_at,o.id FOR UPDATE SKIP LOCKED LIMIT p_limit
 LOOP
  SELECT * INTO s FROM payment_v2.sales WHERE id=op.sale_id FOR UPDATE;
  IF NOT FOUND OR s.state<>'opening' OR NOT s.fence THEN CONTINUE; END IF;
   -- Operation row SKIP LOCKED alone does not serialize duplicate operations
   -- for one sale. The sale lock is held here; skip this sale if a sibling
   -- operation still owns a live open_sale lease.
   IF EXISTS(SELECT 1 FROM payment_v2.operations other WHERE other.sale_id=s.id AND other.action='open_sale' AND other.id<>op.id
    AND other.state='leased' AND other.lease_id IS NOT NULL AND other.leased_by IS NOT NULL AND other.lease_until>clock_timestamp()) THEN CONTINUE; END IF;
  SELECT * INTO l FROM payment_v2.sale_listings WHERE sale_id=s.id FOR SHARE;
  IF NOT FOUND OR l.expires_at<=extract(epoch FROM v_now) OR octet_length(l.message)<>61 OR octet_length(l.signature)<>64 OR octet_length(l.signer)<>32 OR octet_length(l.binding)<>32 OR l.binding<>substring(l.message FROM 14 FOR 32) THEN CONTINUE; END IF;
  IF op.issuer_fencing_token=9223372036854775807 THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_FENCE_EXHAUSTED'; END IF;
  v_token:=op.issuer_fencing_token+1;v_lease:=gen_random_uuid();
  UPDATE payment_v2.operations SET state='leased',lease_id=v_lease,leased_by=session_user,lease_until=v_now+interval '90 seconds',attempts=attempts+1,issuer_fencing_token=v_token
   WHERE id=op.id;
  one:=jsonb_build_object('operationId',op.id,'saleId',s.id,'leaseId',v_lease,'fencingToken',v_token,'leaseUntil',v_now+interval '90 seconds','listing',jsonb_build_object('messageHex',encode(l.message,'hex'),'signatureHex',encode(l.signature,'hex'),'signerHex',encode(l.signer,'hex'),'bindingHex',encode(l.binding,'hex'),'minTotalUnits',l.min_total_units::text,'expiresAt',l.expires_at));
  out_json:=out_json||jsonb_build_array(one);
 END LOOP;
 RETURN out_json;
END $$;

CREATE FUNCTION public.fn_payment_v2_renew_open_sale_lease(p_operation uuid,p_lease uuid,p_token bigint) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_now timestamptz:=clock_timestamp();o payment_v2.operations%rowtype;s payment_v2.sales%rowtype;l payment_v2.sale_listings%rowtype;v_until timestamptz;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 SELECT * INTO o FROM payment_v2.operations WHERE id=p_operation FOR UPDATE;
 IF NOT FOUND OR o.action<>'open_sale' OR o.state<>'leased' OR o.lease_id IS DISTINCT FROM p_lease OR o.issuer_fencing_token IS DISTINCT FROM p_token OR o.leased_by IS DISTINCT FROM session_user OR o.lease_until IS NULL OR o.lease_until<=v_now THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_LEASE_LOST'; END IF;
 SELECT * INTO s FROM payment_v2.sales WHERE id=o.sale_id FOR UPDATE;
 SELECT * INTO l FROM payment_v2.sale_listings WHERE sale_id=s.id FOR SHARE;
  IF s.state<>'opening' OR NOT s.fence OR NOT FOUND OR l.expires_at<=extract(epoch FROM v_now) OR octet_length(l.message)<>61 OR octet_length(l.signature)<>64 OR octet_length(l.signer)<>32 OR octet_length(l.binding)<>32 OR l.binding<>substring(l.message FROM 14 FOR 32) OR l.min_total_units<=0 OR NOT EXISTS(
  SELECT 1 FROM payment_v2.networks n JOIN payment_v2.inventory i ON i.card_id=s.card_id AND i.item_id=s.item_id AND NOT i.quarantined
   JOIN public.listings pl ON pl.id=s.listing_id AND pl.card_id=s.card_id AND pl.seller_id=s.seller_id
   JOIN payment_v2.wallet_accounts wa ON wa.user_id=s.seller_id AND wa.network_id=s.network_id AND wa.wallet=s.seller_wallet AND wa.token_account=s.seller_token
  WHERE n.id=s.network_id AND n.funding_enabled AND (s.network_snapshot).genesis=n.genesis AND (s.network_snapshot).program=n.program
   AND (s.network_snapshot).config=n.config AND (s.network_snapshot).mint=n.mint AND (s.network_snapshot).token_program=n.token_program AND (s.network_snapshot).issuer=n.issuer) THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_LEASE_LOST'; END IF;
 v_until:=v_now+interval '90 seconds';UPDATE payment_v2.operations SET lease_until=v_until WHERE id=o.id;RETURN v_until;
END $$;

CREATE FUNCTION public.fn_payment_v2_finish_open_sale(p_operation uuid,p_lease uuid,p_token bigint,p_outcome text,p_signature text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_now timestamptz:=clock_timestamp();o payment_v2.operations%rowtype;s payment_v2.sales%rowtype;l payment_v2.sale_listings%rowtype;v_state text;
 v_sig numeric:=0;v_sig_bytes bytea:=''::bytea;v_digit integer;v_leading integer:=0;v_i integer;
 v_alphabet constant text:='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 SELECT * INTO o FROM payment_v2.operations WHERE id=p_operation FOR UPDATE;
 IF NOT FOUND OR o.action<>'open_sale' OR o.state<>'leased' OR o.lease_id IS DISTINCT FROM p_lease OR o.issuer_fencing_token IS DISTINCT FROM p_token OR o.leased_by IS DISTINCT FROM session_user OR o.lease_until IS NULL OR o.lease_until<=v_now THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_LEASE_LOST'; END IF;
 SELECT * INTO s FROM payment_v2.sales WHERE id=o.sale_id FOR UPDATE;
 SELECT * INTO l FROM payment_v2.sale_listings WHERE sale_id=s.id FOR SHARE;
  IF s.state<>'opening' OR NOT s.fence OR NOT FOUND OR l.expires_at<=extract(epoch FROM v_now) OR octet_length(l.message)<>61 OR octet_length(l.signature)<>64 OR octet_length(l.signer)<>32 OR octet_length(l.binding)<>32 OR l.binding<>substring(l.message FROM 14 FOR 32) OR l.min_total_units<=0 OR NOT EXISTS(
  SELECT 1 FROM payment_v2.networks n JOIN payment_v2.inventory i ON i.card_id=s.card_id AND i.item_id=s.item_id AND NOT i.quarantined
   JOIN public.listings pl ON pl.id=s.listing_id AND pl.card_id=s.card_id AND pl.seller_id=s.seller_id
   JOIN payment_v2.wallet_accounts wa ON wa.user_id=s.seller_id AND wa.network_id=s.network_id AND wa.wallet=s.seller_wallet AND wa.token_account=s.seller_token
  WHERE n.id=s.network_id AND n.funding_enabled AND (s.network_snapshot).genesis=n.genesis AND (s.network_snapshot).program=n.program
   AND (s.network_snapshot).config=n.config AND (s.network_snapshot).mint=n.mint AND (s.network_snapshot).token_program=n.token_program AND (s.network_snapshot).issuer=n.issuer) THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_LEASE_LOST'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN('send_ack','send_unknown','preexisting_exact_pda','conflict','retryable_failure') THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_FINISH_OUTCOME'; END IF;
 IF (p_outcome IN('send_ack','send_unknown','preexisting_exact_pda'))<>(p_signature IS NOT NULL) THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SIGNATURE_SHAPE'; END IF;
 IF p_signature IS NOT NULL THEN
  IF p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$' THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SIGNATURE_SHAPE'; END IF;
  FOR v_i IN 1..length(p_signature) LOOP v_digit:=strpos(v_alphabet,substr(p_signature,v_i,1))-1;IF v_digit<0 THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SIGNATURE_SHAPE';END IF;v_sig:=v_sig*58+v_digit;END LOOP;
  WHILE v_sig>0 LOOP v_sig_bytes:=set_byte(decode('00','hex'),0,mod(v_sig,256)::integer)||v_sig_bytes;v_sig:=trunc(v_sig/256);END LOOP;
  WHILE v_leading<length(p_signature) AND substr(p_signature,v_leading+1,1)='1' LOOP v_leading:=v_leading+1;END LOOP;
  v_sig_bytes:=decode(repeat('00',v_leading),'hex')||v_sig_bytes;
  IF octet_length(v_sig_bytes)<>64 THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SIGNATURE_SHAPE'; END IF;
 END IF;
 v_state:=CASE p_outcome WHEN 'send_ack' THEN 'submitted' WHEN 'send_unknown' THEN 'unknown' WHEN 'preexisting_exact_pda' THEN 'submitted' WHEN 'conflict' THEN 'unknown' ELSE 'pending' END;
 UPDATE payment_v2.operations SET state=v_state,signature=CASE WHEN p_outcome IN('send_ack','preexisting_exact_pda') THEN p_signature ELSE NULL END,
  ready=CASE WHEN p_outcome='conflict' THEN false ELSE ready END,last_error=CASE WHEN p_outcome='conflict' THEN 'issuer observed conflicting PDA; reconcile required' WHEN p_outcome='retryable_failure' THEN 'issuer retryable send failure' ELSE NULL END,
  available_at=CASE WHEN p_outcome='retryable_failure' THEN v_now+interval '5 seconds' ELSE available_at END,
  lease_id=NULL,leased_by=NULL,lease_until=NULL WHERE id=o.id;
END $$;

-- Founder-only cleanup function; it can delete expired rows only, bounded by limit.
CREATE FUNCTION payment_v2.cleanup_issuer_nonces(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF session_user NOT IN('supabase_admin','postgres') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_CLEANUP_FORBIDDEN'; END IF;
 WITH gone AS (SELECT ctid FROM payment_v2.issuer_hmac_nonces WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 DELETE FROM payment_v2.issuer_hmac_nonces x USING gone g WHERE x.ctid=g.ctid;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;

GRANT CREATE ON SCHEMA public TO payment_v2_owner;
DO $owner$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
  'public.fn_payment_v2_issuer_subject_context(text,uuid,uuid)',
  'public.fn_payment_v2_issuer_enroll_wallet_checked(uuid,uuid,bytea,bytea,bytea)',
  'public.fn_payment_v2_consume_issuer_nonce(text,bytea)',
  'public.fn_payment_v2_claim_open_sale(integer)',
  'public.fn_payment_v2_renew_open_sale_lease(uuid,uuid,bigint)',
  'public.fn_payment_v2_finish_open_sale(uuid,uuid,bigint,text,text)'] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO payment_v2_owner',f);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier',f);
 END LOOP;
 ALTER FUNCTION payment_v2.guard_issuer_hmac_event() OWNER TO payment_v2_owner;
  REVOKE ALL ON FUNCTION payment_v2.guard_issuer_hmac_event() FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
 ALTER FUNCTION payment_v2.operations_terms_guard_086() OWNER TO payment_v2_owner;
 ALTER FUNCTION payment_v2.cleanup_issuer_nonces(integer) OWNER TO payment_v2_owner;
 REVOKE ALL ON FUNCTION payment_v2.cleanup_issuer_nonces(integer) FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
END $owner$;
REVOKE CREATE ON SCHEMA public FROM payment_v2_owner;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_issuer_subject_context(text,uuid,uuid) TO payment_v2_issuer;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_issuer_enroll_wallet_checked(uuid,uuid,bytea,bytea,bytea) TO payment_v2_issuer;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_consume_issuer_nonce(text,bytea) TO payment_v2_issuer;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_claim_open_sale(integer) TO payment_v2_issuer;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_renew_open_sale_lease(uuid,uuid,bigint) TO payment_v2_issuer;
GRANT EXECUTE ON FUNCTION public.fn_payment_v2_finish_open_sale(uuid,uuid,bigint,text,text) TO payment_v2_issuer;

DO $post$
DECLARE r record;fn regprocedure;acl_role text;
BEGIN
 IF EXISTS(SELECT 1 FROM m086_before b JOIN pg_proc p ON p.oid=b.oid WHERE md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM b.body OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR p.prosecdef IS DISTINCT FROM b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig)
  OR EXISTS(SELECT 1 FROM m086_before b WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=b.oid)) THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_PREEXISTING_FUNCTION_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='payment_v2' OR (n.nspname='public' AND p.proname LIKE 'fn\_payment\_v2\_%')) AND p.oid NOT IN(SELECT oid FROM m086_before) AND
  (p.proowner<>'payment_v2_owner'::regrole OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])) THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_FUNCTION_HARDENING'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN('payment_v2.issuer_hmac_keys'::regclass,'payment_v2.issuer_hmac_key_events'::regclass,'payment_v2.issuer_hmac_nonces'::regclass) AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR EXISTS(SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee NOT IN(c.relowner) OR a.privilege_type<>'SELECT' AND a.privilege_type<>'INSERT' AND a.privilege_type<>'UPDATE' AND a.privilege_type<>'DELETE' AND a.privilege_type<>'TRUNCATE' AND a.privilege_type<>'REFERENCES' AND a.privilege_type<>'TRIGGER' AND a.privilege_type<>'MAINTAIN'))) THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_TABLE_HARDENING'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='payment_v2.guard_issuer_hmac_event()'::regprocedure AND EXISTS(
    SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_EVENT_GUARD_ACL'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class s WHERE s.oid='payment_v2.issuer_hmac_key_events_id_seq'::regclass AND
    (s.relowner<>'payment_v2_owner'::regrole OR EXISTS(SELECT 1 FROM aclexplode(coalesce(s.relacl,acldefault('S',s.relowner))) a WHERE a.grantee<>s.relowner))) THEN
   RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SEQUENCE_ACL'; END IF;
  FOREACH acl_role IN ARRAY ARRAY['anon','authenticated','service_role','payment_v2_issuer','payment_v2_verifier','payment_v2_executor','payment_v2_settler','payment_v2_notifier'] LOOP
   IF has_function_privilege(acl_role,'payment_v2.guard_issuer_hmac_event()'::regprocedure,'EXECUTE') THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_EVENT_GUARD_ACL'; END IF;
   IF has_sequence_privilege(acl_role,'payment_v2.issuer_hmac_key_events_id_seq','USAGE') OR has_sequence_privilege(acl_role,'payment_v2.issuer_hmac_key_events_id_seq','SELECT') OR has_sequence_privilege(acl_role,'payment_v2.issuer_hmac_key_events_id_seq','UPDATE') THEN
    RAISE EXCEPTION 'PAYMENT_V2_ISSUER_SEQUENCE_ACL'; END IF;
  END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='payment_v2.operations'::regclass AND tgname='immutable_terms' AND NOT tgisinternal AND tgenabled='O' AND tgfoid='payment_v2.operations_terms_guard_086()'::regprocedure)
  OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='payment_v2.operations'::regclass AND tgname='immutable_terms' AND NOT tgisinternal)<>1 THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_OPERATION_TERMS_GUARD_POSTGUARD'; END IF;
 FOR r IN SELECT x.role_name,f.allowed,f.sig FROM unnest(ARRAY['anon','authenticated','service_role','payment_v2_issuer','payment_v2_verifier','payment_v2_executor','payment_v2_settler','payment_v2_notifier']) x(role_name)
  CROSS JOIN (VALUES
   ('public.fn_payment_v2_issuer_subject_context(text,uuid,uuid)'::regprocedure,'payment_v2_issuer'),
   ('public.fn_payment_v2_issuer_enroll_wallet_checked(uuid,uuid,bytea,bytea,bytea)'::regprocedure,'payment_v2_issuer'),
   ('public.fn_payment_v2_consume_issuer_nonce(text,bytea)'::regprocedure,'payment_v2_issuer'),
   ('public.fn_payment_v2_claim_open_sale(integer)'::regprocedure,'payment_v2_issuer'),
   ('public.fn_payment_v2_renew_open_sale_lease(uuid,uuid,bigint)'::regprocedure,'payment_v2_issuer'),
   ('public.fn_payment_v2_finish_open_sale(uuid,uuid,bigint,text,text)'::regprocedure,'payment_v2_issuer')) f(sig,allowed)
 LOOP IF has_function_privilege(r.role_name,r.sig,'EXECUTE') IS DISTINCT FROM(r.role_name=r.allowed) THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_ACL_MATRIX';END IF; END LOOP;
 FOREACH fn IN ARRAY ARRAY[
  'public.fn_payment_v2_issuer_subject_context(text,uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_issuer_enroll_wallet_checked(uuid,uuid,bytea,bytea,bytea)'::regprocedure,
  'public.fn_payment_v2_consume_issuer_nonce(text,bytea)'::regprocedure,
  'public.fn_payment_v2_claim_open_sale(integer)'::regprocedure,
  'public.fn_payment_v2_renew_open_sale_lease(uuid,uuid,bigint)'::regprocedure,
  'public.fn_payment_v2_finish_open_sale(uuid,uuid,bigint,text,text)'::regprocedure]
 LOOP IF NOT has_function_privilege('payment_v2_owner',fn,'EXECUTE') OR NOT has_function_privilege('payment_v2_issuer',fn,'EXECUTE') THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_ALLOWED_ROLE_ACL'; END IF; END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN('public.fn_payment_v2_issuer_subject_context(text,uuid,uuid)'::regprocedure,'public.fn_payment_v2_issuer_enroll_wallet_checked(uuid,uuid,bytea,bytea,bytea)'::regprocedure,'public.fn_payment_v2_consume_issuer_nonce(text,bytea)'::regprocedure,'public.fn_payment_v2_claim_open_sale(integer)'::regprocedure,'public.fn_payment_v2_renew_open_sale_lease(uuid,uuid,bigint)'::regprocedure,'public.fn_payment_v2_finish_open_sale(uuid,uuid,bigint,text,text)'::regprocedure) AND EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) THEN RAISE EXCEPTION 'PAYMENT_V2_ISSUER_PUBLIC_EXECUTE'; END IF;
END $post$;

COMMIT;
