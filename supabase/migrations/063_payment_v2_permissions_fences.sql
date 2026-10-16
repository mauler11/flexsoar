-- DRAFT ONLY / NOT EXECUTED. REQUIRED final hardening stage; funding must remain disabled.
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
-- Catalog preflight: historical function identities are inventoried, not assumed from names/arity.
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_purchase_card') THEN RAISE EXCEPTION 'expected legacy purchase overload missing: review catalog';END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION 'funding must stay disabled throughout cutover';END IF;
END $preflight$;
CREATE FUNCTION payment_v2.terms_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE excluded text[];
BEGIN
 excluded:=CASE TG_TABLE_NAME WHEN 'sales' THEN ARRAY['state','fence','chain_acknowledged'] WHEN 'attempts' THEN ARRAY['state','permit','authorized_by','authorized_at']
 WHEN 'operations' THEN ARRAY['state','ready','lease_id','leased_by','worker_id','lease_until','attempts','signature','resolved_event','last_error','available_at']
 WHEN 'outbox' THEN ARRAY['state','lease_id','leased_by','lease_until','attempts','delivered_at','last_error','available_at'] ELSE ARRAY[]::text[] END;
 IF (to_jsonb(NEW)-excluded) IS DISTINCT FROM (to_jsonb(OLD)-excluded) THEN RAISE EXCEPTION 'PAYMENT_V2_TERMS_IMMUTABLE';END IF;
 IF TG_TABLE_NAME='attempts' THEN
  IF OLD.permit IS NOT NULL AND (NEW.permit,NEW.authorized_by,NEW.authorized_at) IS DISTINCT FROM (OLD.permit,OLD.authorized_by,OLD.authorized_at) THEN RAISE EXCEPTION 'PAYMENT_V2_PERMIT_IMMUTABLE';END IF;
  IF OLD.state IN('funded','direct','released','refunded') AND NEW.state IN('initiated','authorized','unresolved') THEN RAISE EXCEPTION 'PAYMENT_V2_CANNOT_FORGET_PAYMENT';END IF;
 END IF;
 IF TG_TABLE_NAME='sales' AND OLD.state IN('direct','released','refunded','revoked') AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'PAYMENT_V2_TERMINAL_IMMUTABLE';END IF;
 IF TG_TABLE_NAME='operations' AND NEW.resolved_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_v2.events WHERE id=NEW.resolved_event AND sale_id=NEW.sale_id) THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_RESOLUTION_CONFLICT';END IF;
 IF TG_TABLE_NAME='operations' AND OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_IDENTITY_IMMUTABLE';END IF;
 RETURN NEW;
END $$;
CREATE TABLE payment_v2.configuration_history(
 id bigserial PRIMARY KEY,entity text NOT NULL,entity_id uuid NOT NULL,before_value jsonb,after_value jsonb NOT NULL,
 actor_login name NOT NULL,changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.configuration_history FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE FUNCTION payment_v2.audit_configuration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN INSERT INTO payment_v2.configuration_history(entity,entity_id,before_value,after_value,actor_login) VALUES(TG_TABLE_NAME,NEW.id,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW),session_user);RETURN NEW;END $$;
CREATE TRIGGER audit_configuration AFTER INSERT OR UPDATE ON payment_v2.staff FOR EACH ROW EXECUTE FUNCTION payment_v2.audit_configuration();
CREATE TRIGGER audit_configuration AFTER INSERT OR UPDATE ON payment_v2.networks FOR EACH ROW EXECUTE FUNCTION payment_v2.audit_configuration();
CREATE FUNCTION payment_v2.staff_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN IF EXISTS(SELECT 1 FROM payment_v2.staff st WHERE st.id<>NEW.id AND (st.user_id=NEW.user_id OR st.public_key=NEW.public_key) AND st.person_id<>NEW.person_id) THEN RAISE EXCEPTION 'PAYMENT_V2_PERSON_BINDING';END IF;IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') THEN RAISE EXCEPTION 'PAYMENT_V2_STAFF_IDENTITY_IMMUTABLE';END IF;RETURN NEW;END $$;
CREATE TRIGGER immutable_staff BEFORE INSERT OR UPDATE ON payment_v2.staff FOR EACH ROW EXECUTE FUNCTION payment_v2.staff_identity();
CREATE TRIGGER immutable_terms BEFORE UPDATE ON payment_v2.sales FOR EACH ROW EXECUTE FUNCTION payment_v2.terms_guard();
CREATE TRIGGER immutable_terms BEFORE UPDATE ON payment_v2.attempts FOR EACH ROW EXECUTE FUNCTION payment_v2.terms_guard();
CREATE TRIGGER immutable_terms BEFORE UPDATE ON payment_v2.operations FOR EACH ROW EXECUTE FUNCTION payment_v2.terms_guard();
CREATE TRIGGER immutable_terms BEFORE UPDATE ON payment_v2.outbox FOR EACH ROW EXECUTE FUNCTION payment_v2.terms_guard();
CREATE FUNCTION payment_v2.correspondence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ok boolean;
BEGIN
 IF TG_TABLE_NAME='inventory' THEN
  SELECT EXISTS(SELECT 1 FROM public.cards c JOIN public.items i ON i.id=c.item_id JOIN payment_v2.staff a ON a.id=NEW.enrolled_by JOIN payment_v2.staff b ON b.id=NEW.approved_by
   WHERE c.id=NEW.card_id AND c.item_id=NEW.item_id AND (TG_OP='UPDATE' OR (a.active AND b.active)) AND a.role='inventory' AND b.role='reviewer' AND a.person_id<>b.person_id
   AND (NEW.quarantined OR NEW.mode=CASE i.custody WHEN 'warehouse' THEN 1 ELSE 0 END)) INTO ok;
  IF TG_OP='UPDATE' AND (NEW.card_id,NEW.item_id,NEW.card_commitment,NEW.pair_commitment,NEW.enrollment_evidence,NEW.enrolled_by,NEW.approved_by) IS DISTINCT FROM (OLD.card_id,OLD.item_id,OLD.card_commitment,OLD.pair_commitment,OLD.enrollment_evidence,OLD.enrolled_by,OLD.approved_by) THEN RAISE EXCEPTION 'PAYMENT_V2_PAIR_IMMUTABLE';END IF;
 ELSIF TG_TABLE_NAME='events' THEN
  SELECT EXISTS(SELECT 1 FROM payment_v2.attempts a WHERE a.id=NEW.attempt_id AND a.sale_id=NEW.sale_id AND a.network_id=NEW.network_id AND a.permit IS NOT NULL AND NEW.proof->>'permitHex'=encode(a.permit,'hex') AND NEW.proof_digest=sha256(convert_to(NEW.proof::text,'UTF8'))) INTO ok;
 ELSIF TG_TABLE_NAME='usdc_journal' THEN
  SELECT EXISTS(SELECT 1 FROM payment_v2.events e JOIN payment_v2.sales s ON s.id=e.sale_id WHERE e.id=NEW.event_id AND e.network_id=NEW.network_id AND (s.network_snapshot).mint=NEW.mint) INTO ok;
 ELSIF TG_TABLE_NAME='escrows' THEN
  SELECT EXISTS(SELECT 1 FROM payment_v2.events e JOIN public.orders o ON o.payment_v2_attempt_id=e.attempt_id WHERE e.id=NEW.funding_event AND e.kind='funded' AND e.sale_id=NEW.sale_id AND e.attempt_id=NEW.attempt_id AND o.id=NEW.order_id) INTO ok;
  IF NEW.terminal_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_v2.events e WHERE e.id=NEW.terminal_event AND e.sale_id=NEW.sale_id AND e.attempt_id=NEW.attempt_id AND e.kind=NEW.state AND e.kind IN('released','refunded')) THEN ok:=false;END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.sale_id,NEW.attempt_id,NEW.order_id,NEW.funding_event,NEW.dispatch_due) IS DISTINCT FROM (OLD.id,OLD.sale_id,OLD.attempt_id,OLD.order_id,OLD.funding_event,OLD.dispatch_due) THEN RAISE EXCEPTION 'PAYMENT_V2_ESCROW_BINDING_IMMUTABLE';END IF;
 ELSE ok:=false;END IF;
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'PAYMENT_V2_CORRESPONDENCE: %',TG_TABLE_NAME;END IF;RETURN NEW;
END $$;
CREATE FUNCTION payment_v2.attempt_correspondence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s payment_v2.sales%rowtype;q payment_v2.quote_books%rowtype;
BEGIN
 SELECT id,listing_id,card_id,item_id,seller_id,network_id,sale_commitment,sale_address,escrow_address,generation,revision,custody_version,mode,network_snapshot,seller_wallet,seller_token,price_cents,policy_version,issuer_terms,state,fence,chain_acknowledged,created_at INTO s.id,s.listing_id,s.card_id,s.item_id,s.seller_id,s.network_id,s.sale_commitment,s.sale_address,s.escrow_address,s.generation,s.revision,s.custody_version,s.mode,s.network_snapshot,s.seller_wallet,s.seller_token,s.price_cents,s.policy_version,s.issuer_terms,s.state,s.fence,s.chain_acknowledged,s.created_at FROM payment_v2.sales WHERE id=NEW.sale_id;SELECT id,sale_id,total_units,fx_snapshot,valid_from,expires_at,created_at INTO q.id,q.sale_id,q.total_units,q.fx_snapshot,q.valid_from,q.expires_at,q.created_at FROM payment_v2.quote_books WHERE id=NEW.quote_id;
 IF q.sale_id IS DISTINCT FROM s.id OR NEW.total_units IS DISTINCT FROM q.total_units OR NEW.gross_cents IS DISTINCT FROM s.price_cents
 OR NEW.valid_from IS DISTINCT FROM q.valid_from OR NEW.expires_at IS DISTINCT FROM q.expires_at OR NEW.policy_version IS DISTINCT FROM s.policy_version
 OR NEW.attempt_commitment IS DISTINCT FROM sha256(uuid_send(NEW.id)) OR NEW.beneficiary IS DISTINCT FROM sha256(uuid_send(NEW.buyer_id))
 OR NEW.seller_wallet IS DISTINCT FROM s.seller_wallet OR NEW.seller_token IS DISTINCT FROM s.seller_token OR NEW.treasury_token IS DISTINCT FROM (s.network_snapshot).treasury_token
 OR NEW.refund_token IS DISTINCT FROM NEW.buyer_token OR NOT EXISTS(SELECT 1 FROM payment_v2.wallet_accounts w WHERE w.user_id=NEW.buyer_id AND w.network_id=NEW.network_id AND w.wallet=NEW.buyer_wallet AND w.token_account=NEW.buyer_token)
 THEN RAISE EXCEPTION 'PAYMENT_V2_ATTEMPT_TERMS_CONFLICT';END IF;RETURN NEW;
END $$;
CREATE TRIGGER correspondence BEFORE INSERT ON payment_v2.attempts FOR EACH ROW EXECUTE FUNCTION payment_v2.attempt_correspondence();
CREATE TRIGGER correspondence BEFORE INSERT OR UPDATE ON payment_v2.inventory FOR EACH ROW EXECUTE FUNCTION payment_v2.correspondence();
CREATE TRIGGER correspondence BEFORE INSERT ON payment_v2.events FOR EACH ROW EXECUTE FUNCTION payment_v2.correspondence();
CREATE TRIGGER correspondence BEFORE INSERT ON payment_v2.usdc_journal FOR EACH ROW EXECUTE FUNCTION payment_v2.correspondence();
CREATE TRIGGER correspondence BEFORE INSERT OR UPDATE ON payment_v2.escrows FOR EACH ROW EXECUTE FUNCTION payment_v2.correspondence();
-- Deferred commit invariants compare consumed evidence with exact base-unit allocations,
-- not merely a zero journal sum. MYR order valuation never enters this journal.
CREATE FUNCTION payment_v2.consumption_correspondence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e payment_v2.events%rowtype;a payment_v2.attempts%rowtype;s payment_v2.sales%rowtype;bad boolean;
BEGIN
 SELECT attempt_id,sale_id,kind,network_id,genesis,signature INTO e.attempt_id,e.sale_id,e.kind,e.network_id,e.genesis,e.signature FROM payment_v2.events WHERE id=NEW.event_id;
 SELECT total_units,net_units,fee_units,buyer_wallet,seller_wallet,buyer_id,seller_id,card_id,listing_id,gross_cents,fee_cents,net_cents INTO a.total_units,a.net_units,a.fee_units,a.buyer_wallet,a.seller_wallet,a.buyer_id,a.seller_id,a.card_id,a.listing_id,a.gross_cents,a.fee_cents,a.net_cents FROM payment_v2.attempts WHERE id=e.attempt_id;
 SELECT id,network_snapshot,mode INTO s.id,s.network_snapshot,s.mode FROM payment_v2.sales WHERE id=e.sale_id;
 WITH allocations(account,units) AS (
  SELECT 'wallet:'||payment_v2.b58(a.buyer_wallet),-a.total_units WHERE e.kind IN('funded','direct')
  UNION ALL SELECT 'escrow:'||s.id::text,a.total_units WHERE e.kind='funded'
  UNION ALL SELECT 'escrow:'||s.id::text,-a.total_units WHERE e.kind IN('released','refunded')
  UNION ALL SELECT 'wallet:'||payment_v2.b58(a.buyer_wallet),a.total_units WHERE e.kind='refunded'
  UNION ALL SELECT 'wallet:'||payment_v2.b58(a.seller_wallet),a.net_units WHERE e.kind IN('direct','released')
  UNION ALL SELECT 'wallet:'||payment_v2.b58((s.network_snapshot).treasury),a.fee_units WHERE e.kind IN('direct','released')
 ), expected AS (SELECT account,sum(units) AS units FROM allocations GROUP BY account HAVING sum(units)<>0)
 SELECT EXISTS(SELECT 1 FROM expected ex FULL JOIN (SELECT account,units FROM payment_v2.usdc_journal WHERE event_id=NEW.event_id) actual USING(account) WHERE ex.units IS DISTINCT FROM actual.units) INTO bad;
 IF bad OR NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.id=NEW.order_id AND o.payment_v2_attempt_id=e.attempt_id AND o.buyer_id=a.buyer_id AND o.seller_id=a.seller_id AND o.card_id=a.card_id AND o.listing_id=a.listing_id
 AND o.gross_cents=a.gross_cents AND o.fee_cents=a.fee_cents AND o.net_cents=a.net_cents AND o.cash_cents=0 AND o.credit_cents=0 AND o.seller_payout IS NULL AND NOT o.paid_out AND o.stripe_transfer_id IS NULL
 AND o.payment_rail=CASE s.mode WHEN 0 THEN 'solana_v2_escrow' ELSE 'solana_v2_direct' END) THEN RAISE EXCEPTION 'PAYMENT_V2_CONSUMED_ACCOUNTING_CONFLICT';END IF;
 IF (SELECT coalesce(sum(l.direction),0) FROM public.ledger_entries l JOIN public.cards c ON c.id=l.card_id WHERE c.id=a.card_id AND l.asset='card' AND l.account_id=c.owner_id)<>1
 OR EXISTS(SELECT 1 FROM public.ledger_entries l JOIN public.cards c ON c.id=l.card_id WHERE c.id=a.card_id AND l.asset='card' AND l.account_id IS NOT NULL AND l.account_id<>c.owner_id GROUP BY l.account_id HAVING sum(l.direction)<>0) THEN RAISE EXCEPTION 'PAYMENT_V2_OWNER_CACHE_LEDGER_CONFLICT';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER consumption_correspondence AFTER INSERT ON payment_v2.consumptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_v2.consumption_correspondence();
-- Invoker trigger is essential: a SECURITY DEFINER guard would see its own owner and permit every call.
-- The helper returns only whether legacy writes touch enrolled financial inventory.
CREATE FUNCTION public.fn_payment_v2_managed(p_table text,p_row jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE
 WHEN p_table='items' THEN EXISTS(SELECT 1 FROM payment_v2.inventory WHERE item_id=(p_row->>'id')::uuid)
 WHEN p_table='cards' THEN EXISTS(SELECT 1 FROM payment_v2.inventory WHERE card_id=(p_row->>'id')::uuid OR item_id=(p_row->>'item_id')::uuid)
 WHEN p_table='trade_offers' THEN EXISTS(SELECT 1 FROM payment_v2.inventory WHERE card_id IN((p_row->>'offered_card_id')::uuid,(p_row->>'requested_card_id')::uuid))
 WHEN p_table='credit_holds' THEN EXISTS(SELECT 1 FROM payment_v2.sales WHERE listing_id=(p_row->>'listing_id')::uuid)
 ELSE EXISTS(SELECT 1 FROM payment_v2.inventory WHERE card_id=(p_row->>'card_id')::uuid) OR (p_table='orders' AND coalesce(p_row->>'payment_rail','legacy_unverified')<>'legacy_unverified') END
$$;
CREATE FUNCTION public.fn_payment_v2_legacy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='payment_v2_owner' THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF (TG_OP<>'INSERT' AND public.fn_payment_v2_managed(TG_TABLE_NAME,to_jsonb(OLD))) OR (TG_OP<>'DELETE' AND public.fn_payment_v2_managed(TG_TABLE_NAME,to_jsonb(NEW))) THEN
  RAISE EXCEPTION 'PAYMENT_V2_LEGACY_MUTATION_FENCED' USING ERRCODE='42501';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
DO $fences$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['cards','items','listings','orders','ledger_entries','redemptions','vault_intakes','card_provenance','trade_offers','credit_holds'] LOOP
  IF to_regclass('public.'||n) IS NOT NULL THEN EXECUTE format('CREATE TRIGGER payment_v2_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_payment_v2_legacy_guard()',n);END IF;
 END LOOP;
END $fences$;
-- Remove automatic receipt/authentication/unlock and generic first-order intake behavior.
-- Historical rows are preserved. Every old vault lifecycle function is retired below.
DO $triggers$ DECLARE t record;BEGIN
 FOR t IN SELECT c.relname,tr.tgname FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid JOIN pg_proc f ON f.oid=tr.tgfoid
 WHERE c.relnamespace='public'::regnamespace AND NOT tr.tgisinternal AND f.proname IN('trg_open_vault_intake','trg_hold_card_pending_vault') LOOP
  EXECUTE format('DROP TRIGGER %I ON public.%I',t.tgname,t.relname);
 END LOOP;
END $triggers$;
-- All overloads, including defaults and helpers; preserve identity/result signature, replace authorization bypass with refusal.
DO $legacy$ DECLARE f record;g record;BEGIN
 FOR f IN SELECT p.oid,p.oid::regprocedure AS sig,p.proname,pg_get_function_arguments(p.oid) AS args,pg_get_function_result(p.oid) AS result
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND
 (p.proname IN('fn_purchase_card','fn_purchase_card_core','fn_purchase_card_with_credit','fn_purchase_credit','fn_reserve_credit','fn_list_card','fn_cancel_listing','fn_redeem_card','fn_vault_mark_shipped','fn_vault_receive','fn_vault_mark_defaulted','fn_confirm_sale_cancellation','fn_accept_trade_offer','fn_create_trade_offer','fn_accept_trade','fn_create_trade')
 OR p.proname LIKE 'fn_purchase_card_%') LOOP
  EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $retired$ BEGIN RAISE EXCEPTION ''PAYMENT_V2_LEGACY_PATH_RETIRED: coordinated v2 cutover required'' USING ERRCODE=''42501''; END $retired$',f.proname,f.args,f.result);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
  FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.oid AND a.grantee<>p.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.sig,g.rolname);
  END LOOP;
 END LOOP;
END $legacy$;
-- Private workers receive RPC execution only, never direct table DML.
DO $ownership$ DECLARE t record;f record;g record;n text;BEGIN
 FOR t IN SELECT c.relname,c.relkind FROM pg_class c WHERE c.relnamespace='payment_v2'::regnamespace AND c.relkind IN('r','S') ORDER BY CASE c.relkind WHEN 'r' THEN 0 ELSE 1 END LOOP
  IF t.relkind='r' THEN
   EXECUTE format('ALTER TABLE payment_v2.%I OWNER TO payment_v2_owner',t.relname);
   EXECUTE format('ALTER TABLE payment_v2.%I ENABLE ROW LEVEL SECURITY',t.relname);
  ELSE EXECUTE format('ALTER SEQUENCE payment_v2.%I OWNER TO payment_v2_owner',t.relname);END IF;
 END LOOP;
 ALTER DOMAIN payment_v2.key32 OWNER TO payment_v2_owner;ALTER DOMAIN payment_v2.u64 OWNER TO payment_v2_owner;
 FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace='payment_v2'::regnamespace OR (p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn_payment_v2_%') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO payment_v2_owner',f.sig);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
  FOR g IN SELECT DISTINCT r.rolname FROM pg_proc pr CROSS JOIN LATERAL aclexplode(coalesce(pr.proacl,acldefault('f',pr.proowner))) acl JOIN pg_roles r ON r.oid=acl.grantee WHERE pr.oid=f.sig::oid AND acl.grantee<>pr.proowner LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.sig,g.rolname);END LOOP;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['users','items','cards','listings','orders','ledger_entries'] LOOP
  EXECUTE format('GRANT SELECT ON public.%I TO payment_v2_owner',n);
  IF n='users' THEN EXECUTE 'CREATE POLICY payment_v2_owner_access ON public.users FOR SELECT TO payment_v2_owner USING(true)';ELSE EXECUTE format('CREATE POLICY payment_v2_owner_access ON public.%I TO payment_v2_owner USING(true) WITH CHECK(true)',n);END IF;
 END LOOP;
 GRANT UPDATE ON public.items,public.cards TO payment_v2_owner;
 GRANT INSERT,UPDATE ON public.listings,public.orders TO payment_v2_owner;
 GRANT INSERT ON public.ledger_entries TO payment_v2_owner;
 EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %s TO payment_v2_owner',pg_get_serial_sequence('public.ledger_entries','id'));
 -- Direct financial writes, including inherited default service grants, must not bypass lifecycle.
 FOREACH n IN ARRAY ARRAY['cards','items','listings','orders','ledger_entries','redemptions','vault_intakes','card_provenance','trade_offers'] LOOP
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
 END LOOP;
END $ownership$;
DO $column_grants$ DECLARE t record;g record;BEGIN
 FOR t IN SELECT c.relname,a.attname,a.attacl FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relname IN('cards','items','listings','orders','ledger_entries','redemptions','vault_intakes','card_provenance','trade_offers') AND a.attnum>0 AND a.attacl IS NOT NULL LOOP
 EXECUTE format('REVOKE INSERT(%I),UPDATE(%I),REFERENCES(%I) ON public.%I FROM PUBLIC',t.attname,t.attname,t.attname,t.relname);
 FOR g IN SELECT DISTINCT r.rolname FROM aclexplode(t.attacl) acl JOIN pg_roles r ON r.oid=acl.grantee WHERE r.rolname IN('anon','authenticated','service_role') LOOP EXECUTE format('REVOKE INSERT(%I),UPDATE(%I),REFERENCES(%I) ON public.%I FROM %I',t.attname,t.attname,t.attname,t.relname,g.rolname);END LOOP;END LOOP;END $column_grants$;
REVOKE ALL ON ALL TABLES IN SCHEMA payment_v2 FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA payment_v2 FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
REVOKE CREATE ON SCHEMA public FROM payment_v2_owner;
-- Minimal explicit RPC exposure. No service_role membership or grants.
DO $grants$ DECLARE f record;r text;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS sig,p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn_payment_v2_%' LOOP
  r:=CASE
   WHEN f.proname IN('fn_payment_v2_prepare_sale','fn_payment_v2_authorize_attempt') THEN 'payment_v2_issuer'
   WHEN f.proname IN('fn_payment_v2_begin_scan','fn_payment_v2_finish_scan','fn_payment_v2_recovery_binding','fn_payment_v2_record_verified_event','fn_payment_v2_record_attestation','fn_payment_v2_record_lifecycle','fn_payment_v2_record_operation_failure') THEN 'payment_v2_verifier'
   WHEN f.proname='fn_payment_v2_reconcile_event' THEN 'payment_v2_settler'
   WHEN f.proname IN('fn_payment_v2_claim_operations','fn_payment_v2_finish_operation','fn_payment_v2_operation_context','fn_payment_v2_signed_operation','fn_payment_v2_stage_signed_operation') THEN 'payment_v2_executor'
   WHEN f.proname IN('fn_payment_v2_claim_outbox','fn_payment_v2_finish_outbox') THEN 'payment_v2_notifier'
   WHEN f.proname IN('fn_payment_v2_initiate','fn_payment_v2_own_attempts','fn_payment_v2_attach_candidate','fn_payment_v2_record_decision','fn_payment_v2_approve_refund','fn_payment_v2_admin_queue','fn_payment_v2_admin_obligations','fn_payment_v2_list_card','fn_payment_v2_request_cancel','fn_payment_v2_redeem_card','fn_payment_v2_review_dispatch') THEN 'authenticated'
   WHEN f.proname IN('fn_payment_v2_managed','fn_payment_v2_legacy_guard') THEN 'PUBLIC' END;
  IF f.proname='fn_payment_v2_worker_identity' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier',f.sig);CONTINUE;END IF;
  IF r IS NULL THEN RAISE EXCEPTION 'unclassified payment RPC %',f.sig;END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s',f.sig,CASE WHEN r='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r) END);
 END LOOP;
 GRANT USAGE ON SCHEMA public TO payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
END $grants$;
DO $postflight$ DECLARE r text;BEGIN
 IF has_table_privilege('payment_v2_owner','public.users','UPDATE') OR has_any_column_privilege('payment_v2_owner','public.users','UPDATE') THEN RAISE EXCEPTION 'unexpected inherited user mutation privilege; review catalog';END IF;
 FOREACH r IN ARRAY ARRAY['payment_v2_owner','payment_v2_issuer','payment_v2_verifier','payment_v2_settler','payment_v2_executor','payment_v2_notifier'] LOOP
  IF pg_has_role('authenticator',r::name,'MEMBER') OR pg_has_role('service_role',r::name,'MEMBER') OR pg_has_role('authenticated',r::name,'MEMBER') OR pg_has_role('anon',r::name,'MEMBER') THEN RAISE EXCEPTION 'unsafe existing membership in %',r;END IF;
 END LOOP;
END $postflight$;
COMMIT;
