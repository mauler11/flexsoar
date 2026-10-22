-- ============================================================================
-- 083_payment_v2_seller_listing_floor.sql   *** DRAFT: container-tested, NOT staged, NOT applied anywhere ***
--
-- Database side of the seller-signed price floor (docs/handoff/solo-operator-design.md section 5, as amended by the P1
-- program upgrade: docs/handoff/solana-p1-upgrade.md). The program refuses a sale whose total is below the floor the
-- card owner signed; this mirrors that so no attempt is ever created or authorized that the chain would refuse.
-- Requires 082. Funding must be disabled on every network. One transaction.
--
-- ADDITIVE ONLY: it creates tables, two issuer RPCs and one trigger. It changes no existing function body, and the
-- postguard proves that by comparing every pre-existing payment function before and after.
--
-- 1. payment_v2.sale_listings: the owner's signed 61-byte listing message and Ed25519 signature for a sale, immutable.
--    The 61 bytes are "FSOARV2-LIST\0" || binding || min_total u64le || list_expires_at i64le, where
--    binding = SHA-256(genesis || program || card_commitment || sale_commitment || generation u64le).
-- 2. payment_v2.listing_policy: singleton (required=false, tolerance_bps=200), audited. 'required' stays false until the
--    program upgrade is deployed and a founder flips it (funding off); flipping is refused while any network has funding on.
-- 3. fn_payment_v2_record_listing(sale, message, signature): issuer role. SQL re-derives the binding from the sale row
--    and checks the floor is within the tolerance of the quote and not above it, and that the listing outlives the quote.
--    SQL CANNOT VERIFY THE ED25519 SIGNATURE: the issuer service verifies it off chain (lib/solana/listing-v2.ts
--    verifyListingSignature) before calling, and the program verifies it again on chain at open_sale. The signature
--    is stored so the worker can build the precompile instruction, not trusted by the database.
-- 4. fn_payment_v2_listing_for_open(sale): issuer role. The data the worker needs to build [ed25519, open_sale].
-- 5. Trigger on payment_v2.attempts (insert, and the authorize update that sets the permit): a sale with a recorded
--    listing refuses an attempt whose total is below the floor or after the listing lapsed; when the policy is
--    'required', a sale with no listing refuses attempts at all.
-- NOT wired here (worker/app): the issuer worker must call record_listing, and must refuse to submit open_sale
-- without the listing instruction (the program enforces it regardless).
-- ============================================================================

BEGIN;

DO $role$
BEGIN
 IF NOT pg_has_role(current_user,'payment_v2_owner','SET') OR NOT pg_has_role(current_user,'payment_v2_owner','USAGE') THEN
  RAISE EXCEPTION '083: % cannot SET ROLE / inherit payment_v2_owner; run as the role that applied 059-082',current_user;
 END IF;
END $role$;

-- Every pre-existing payment function, so the postguard can prove this migration changed none of them.
CREATE TEMP TABLE m083_before ON COMMIT DROP AS
 SELECT p.oid, p.oid::regprocedure::text AS sig, md5(replace(p.prosrc,chr(13),'')) AS body, p.proowner, p.proacl, p.prosecdef, p.proconfig
 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='payment_v2' OR (ns.nspname='public' AND p.proname LIKE 'fn\_payment\_v2\_%');

DO $preguard$
BEGIN
 IF to_regclass('payment_v2.governance_mode') IS NULL THEN RAISE EXCEPTION '083: 082 is not applied';END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION '083: funding must be disabled on every network';END IF;
 IF has_schema_privilege('payment_v2_owner','public','CREATE') THEN RAISE EXCEPTION '083: payment_v2_owner already has CREATE on public; inspect first';END IF;
 IF to_regclass('payment_v2.sale_listings') IS NOT NULL OR to_regclass('payment_v2.listing_policy') IS NOT NULL
  OR to_regprocedure('payment_v2.enforce_seller_floor()') IS NOT NULL OR to_regprocedure('payment_v2.guard_listing_policy()') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_record_listing(uuid,bytea,bytea)') IS NOT NULL OR to_regprocedure('public.fn_payment_v2_listing_for_open(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION '083: seller-listing objects already exist';
 END IF;
 IF to_regprocedure('payment_v2.le64(numeric)') IS NULL OR to_regprocedure('payment_v2.lock_sale(uuid)') IS NULL OR to_regprocedure('payment_v2.b58(bytea)') IS NULL THEN
  RAISE EXCEPTION '083: expected payment_v2 helpers are missing';
 END IF;
END $preguard$;

-- 1. Records (owned by payment_v2_owner, like every payment_v2 table).
SET LOCAL ROLE payment_v2_owner;
CREATE TABLE payment_v2.listing_policy(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton),
 required boolean NOT NULL,
 tolerance_bps integer NOT NULL CHECK(tolerance_bps BETWEEN 0 AND 9999)
);
CREATE TABLE payment_v2.sale_listings(
 sale_id uuid PRIMARY KEY REFERENCES payment_v2.sales(id),
 message bytea NOT NULL CHECK(octet_length(message)=61 AND substring(message FROM 1 FOR 13)=decode('46534f415256322d4c49535400','hex')),
 signature bytea NOT NULL CHECK(octet_length(signature)=64),
 signer bytea NOT NULL CHECK(octet_length(signer)=32),
 binding bytea NOT NULL CHECK(octet_length(binding)=32 AND binding=substring(message FROM 14 FOR 32)),
 min_total_units numeric NOT NULL CHECK(min_total_units>0),
 expires_at bigint NOT NULL,
 recorded_by name NOT NULL DEFAULT session_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
RESET ROLE;
DO $tables$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['listing_policy','sale_listings'] LOOP
  EXECUTE format('ALTER TABLE payment_v2.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON payment_v2.%I FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier',n);
 END LOOP;
END $tables$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.sale_listings FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE TRIGGER no_delete BEFORE DELETE ON payment_v2.listing_policy FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE TRIGGER audit_configuration AFTER INSERT OR UPDATE ON payment_v2.listing_policy FOR EACH ROW EXECUTE FUNCTION payment_v2.audit_configuration();
INSERT INTO payment_v2.listing_policy(required,tolerance_bps) VALUES(false,200);

-- 2. Trigger functions.
SET LOCAL ROLE payment_v2_owner;
-- The policy never changes under live payments.
CREATE FUNCTION payment_v2.guard_listing_policy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION 'PAYMENT_V2_FUNDING_ENABLED';END IF;
 RETURN NEW;
END $$;
-- Mirrors the program: buy_sale refuses total < min_total and any buy at or after the seller's listing expiry.
CREATE FUNCTION payment_v2.enforce_seller_floor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_min numeric;v_exp bigint;
BEGIN
 IF TG_OP='UPDATE' AND NOT (OLD.permit IS NULL AND NEW.permit IS NOT NULL) THEN RETURN NEW;END IF; -- only the authorize step
 SELECT min_total_units,expires_at INTO v_min,v_exp FROM payment_v2.sale_listings WHERE sale_id=NEW.sale_id;
 IF NOT FOUND THEN
  IF (SELECT required FROM payment_v2.listing_policy) THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_REQUIRED';END IF;
  RETURN NEW;
 END IF;
 IF NEW.total_units<v_min THEN RAISE EXCEPTION 'PAYMENT_V2_BELOW_SELLER_FLOOR';END IF;
 IF extract(epoch FROM clock_timestamp())>=v_exp THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_EXPIRED';END IF;
 RETURN NEW;
END $$;
RESET ROLE;
CREATE TRIGGER guard_listing_policy BEFORE UPDATE ON payment_v2.listing_policy FOR EACH ROW EXECUTE FUNCTION payment_v2.guard_listing_policy();
CREATE TRIGGER seller_floor BEFORE INSERT OR UPDATE OF permit ON payment_v2.attempts FOR EACH ROW EXECUTE FUNCTION payment_v2.enforce_seller_floor();

-- 3. Issuer RPCs.
CREATE FUNCTION public.fn_payment_v2_record_listing(p_sale uuid,p_message bytea,p_signature bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s_id uuid;s_card uuid;s_genesis bytea;s_program bytea;s_wallet bytea;s_commit bytea;s_gen numeric;
 v_commit bytea;v_total numeric;v_qexp bigint;v_tol integer;v_min numeric:=0;v_exp numeric:=0;i integer;
 p_message_prior bytea;p_signature_prior bytea;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 IF NOT EXISTS(SELECT 1 FROM payment_v2.sales WHERE id=p_sale) THEN RAISE EXCEPTION 'PAYMENT_V2_SALE_MISSING';END IF; -- lock_sale would say CARD_MISSING
 PERFORM payment_v2.lock_sale(p_sale);
 SELECT id,card_id,(network_snapshot).genesis,(network_snapshot).program,seller_wallet,sale_commitment,generation INTO s_id,s_card,s_genesis,s_program,s_wallet,s_commit,s_gen FROM payment_v2.sales WHERE id=p_sale;
 IF s_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_SALE_MISSING';END IF;
 IF p_message IS NULL OR p_signature IS NULL OR octet_length(p_message)<>61 OR octet_length(p_signature)<>64
  OR substring(p_message FROM 1 FOR 13)<>decode('46534f415256322d4c49535400','hex') THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_MALFORMED';END IF;
 SELECT card_commitment INTO v_commit FROM payment_v2.inventory WHERE card_id=s_card;
 SELECT total_units,expires_at INTO v_total,v_qexp FROM payment_v2.quote_books WHERE sale_id=p_sale;
 SELECT tolerance_bps INTO v_tol FROM payment_v2.listing_policy;
 IF v_commit IS NULL OR v_total IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_CONFIGURED';END IF;
 -- The same five fields the program binds, recomputed from the sale row and never taken from the caller.
 IF substring(p_message FROM 14 FOR 32)<>sha256(s_genesis||s_program||v_commit||s_commit||payment_v2.le64(s_gen)) THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_BINDING';END IF;
 FOR i IN 0..7 LOOP
  v_min:=v_min+get_byte(p_message,45+i)::numeric*(256::numeric^i);
  v_exp:=v_exp+get_byte(p_message,53+i)::numeric*(256::numeric^i);
 END LOOP;
 v_min:=trunc(v_min);v_exp:=trunc(v_exp); -- numeric ^ carries 16 decimals; these are integers
 -- The floor binds the issuer, so it must sit within the tolerance of the quote and never above it.
 IF v_min<ceil(v_total*(10000-v_tol)/10000::numeric) OR v_min>v_total THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_FLOOR_OUT_OF_TOLERANCE';END IF;
 -- A negative (top-bit) expiry reads as >= 2^63 here and is refused with the lapsed ones.
 IF v_exp>=9223372036854775808::numeric OR v_exp<=extract(epoch FROM clock_timestamp()) OR v_exp<v_qexp THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_EXPIRY';END IF;
 SELECT message,signature INTO p_message_prior,p_signature_prior FROM payment_v2.sale_listings WHERE sale_id=p_sale;
 IF FOUND THEN
  IF p_message_prior=p_message AND p_signature_prior=p_signature THEN RETURN;END IF;
  RAISE EXCEPTION 'PAYMENT_V2_LISTING_CONFLICT';
 END IF;
 INSERT INTO payment_v2.sale_listings(sale_id,message,signature,signer,binding,min_total_units,expires_at)
 VALUES(p_sale,p_message,p_signature,s_wallet,substring(p_message FROM 14 FOR 32),v_min,v_exp::bigint);
END $$;

CREATE FUNCTION public.fn_payment_v2_listing_for_open(p_sale uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l payment_v2.sale_listings;
BEGIN
 PERFORM payment_v2.require_role('payment_v2_issuer');
 SELECT * INTO l FROM payment_v2.sale_listings WHERE sale_id=p_sale;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_V2_LISTING_MISSING';END IF;
 RETURN jsonb_build_object('saleId',l.sale_id,'messageHex',encode(l.message,'hex'),'signatureHex',encode(l.signature,'hex'),
  'signer',payment_v2.b58(l.signer),'minTotalUnits',l.min_total_units::text,'expiresAt',l.expires_at::text);
END $$;

-- OWNER TO needs the new owner to hold CREATE on public (067b/069b); the grant exists only inside this transaction.
GRANT CREATE ON SCHEMA public TO payment_v2_owner;
DO $rpc_owner$ DECLARE f text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.fn_payment_v2_record_listing(uuid,bytea,bytea)','public.fn_payment_v2_listing_for_open(uuid)'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO payment_v2_owner',f);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO payment_v2_issuer',f);
 END LOOP;
END $rpc_owner$;
REVOKE CREATE ON SCHEMA public FROM payment_v2_owner;
REVOKE ALL ON FUNCTION payment_v2.guard_listing_policy(),payment_v2.enforce_seller_floor() FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;

DO $postguard$
DECLARE r record;
BEGIN
 -- No pre-existing function changed: same body, owner, ACL, security mode and settings.
 FOR r IN SELECT b.sig FROM m083_before b JOIN pg_proc p ON p.oid=b.oid
   WHERE md5(replace(p.prosrc,chr(13),''))<>b.body OR p.proowner<>b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR p.prosecdef<>b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig LOOP
  RAISE EXCEPTION '083: pre-existing function % changed',r.sig;
 END LOOP;
 IF (SELECT count(*) FROM m083_before b WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=b.oid))<>0 THEN RAISE EXCEPTION '083: a pre-existing function disappeared';END IF;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE (ns.nspname='payment_v2' OR (ns.nspname='public' AND p.proname LIKE 'fn\_payment\_v2\_%')) AND p.oid NOT IN(SELECT oid FROM m083_before))<>4 THEN
  RAISE EXCEPTION '083: expected exactly 4 new functions';
 END IF;
 IF (SELECT count(*) FROM payment_v2.listing_policy)<>1 OR NOT EXISTS(SELECT 1 FROM payment_v2.listing_policy WHERE NOT required AND tolerance_bps=200) THEN RAISE EXCEPTION '083: listing_policy is not exactly (false, 200)';END IF;
 IF (SELECT count(*) FROM payment_v2.configuration_history WHERE entity='listing_policy')<>1 THEN RAISE EXCEPTION '083: listing_policy was not audited exactly once';END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN('payment_v2.listing_policy'::regclass,'payment_v2.sale_listings'::regclass) AND (NOT c.relrowsecurity OR c.relowner<>'payment_v2_owner'::regrole)) THEN RAISE EXCEPTION '083: new tables must be owner-only with RLS';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN('public.fn_payment_v2_record_listing(uuid,bytea,bytea)'::regprocedure,'public.fn_payment_v2_listing_for_open(uuid)'::regprocedure)
    AND (p.proowner<>'payment_v2_owner'::regrole OR NOT p.prosecdef OR NOT has_function_privilege('payment_v2_issuer',p.oid,'EXECUTE')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('payment_v2_verifier',p.oid,'EXECUTE'))) THEN
  RAISE EXCEPTION '083: listing RPC ownership/ACL is wrong';
 END IF;
 IF has_schema_privilege('payment_v2_owner','public','CREATE') THEN RAISE EXCEPTION '083: payment_v2_owner still holds CREATE on public';END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='payment_v2.attempts'::regclass AND tgname='seller_floor' AND NOT tgisinternal)<>1 THEN RAISE EXCEPTION '083: seller_floor trigger missing';END IF;
END $postguard$;

COMMIT;
