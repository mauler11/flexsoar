-- DRAFT ONLY: NOT EXECUTED. Apply 059 -> 060 -> 061 -> 062 -> 063 in an ISOLATED database first.
-- Explicit task authorization permits NEW SQL authorship, NOT execution.
-- No enum additions: existing pending_vault/locked and new checked text states.
BEGIN;
DO $preflight$
DECLARE n text;v_table text;v_column text;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN RAISE EXCEPTION 'payment-v2 requires PostgreSQL15+'; END IF;
  IF to_regnamespace('payment_v2') IS NOT NULL THEN RAISE EXCEPTION 'payment_v2 already exists: inspect, do not overwrite'; END IF;
  FOREACH n IN ARRAY ARRAY['users','items','cards','listings','orders','ledger_entries','card_provenance','vault_intakes','trade_offers'] LOOP
    IF to_regclass('public.'||n) IS NULL THEN RAISE EXCEPTION 'missing prerequisite public.%',n; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.users'::regclass AND attname='solana_address' AND NOT attisdropped)
     OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='paid_out' AND NOT attisdropped)
     OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.listings'::regclass AND attname='public_at' AND NOT attisdropped)
     OR NOT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.card_status'::regtype AND enumlabel='pending_vault') THEN
    RAISE EXCEPTION 'expected 032/056/058-era schema; obtain catalog evidence before migration';
  END IF;
  FOREACH n IN ARRAY ARRAY['users.auth_id','users.solana_address','users.country_code','items.custody','items.custody_holder_id','items.authenticated_at','items.authenticated_by','cards.item_id','cards.owner_id','cards.status','listings.card_id','listings.seller_id','listings.price_cents','listings.sold_at','listings.payout_method','listings.fair_price_cents','orders.txn_id','orders.credit_cents','orders.cash_cents','orders.seller_payout','orders.payout_release_at','orders.stripe_transfer_id','ledger_entries.txn_id','ledger_entries.entry_type','ledger_entries.asset','ledger_entries.direction'] LOOP
    v_table:=split_part(n,'.',1);v_column:=split_part(n,'.',2);
    IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||v_table) AND attname=v_column AND NOT attisdropped) THEN RAISE EXCEPTION 'missing required column public.%',n;END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='status' AND atttypid='text'::regtype) THEN RAISE EXCEPTION 'expected orders.status text; review status contract';END IF;
  IF pg_get_serial_sequence('public.ledger_entries','id') IS NULL THEN RAISE EXCEPTION 'expected ledger identity sequence; review catalog';END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'payment_v2_%') THEN
    RAISE EXCEPTION 'payment-v2 roles already exist: review ownership/membership before drafting forward repair';
  END IF;
END $preflight$;
CREATE ROLE payment_v2_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE payment_v2_issuer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE payment_v2_verifier NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE payment_v2_settler NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE payment_v2_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE payment_v2_notifier NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA payment_v2 AUTHORIZATION payment_v2_owner;
REVOKE ALL ON SCHEMA payment_v2 FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public,auth TO payment_v2_owner;
GRANT CREATE ON SCHEMA public TO payment_v2_owner; -- migration object ownership; never grant owner membership to workers
ALTER DEFAULT PRIVILEGES FOR ROLE payment_v2_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE DOMAIN payment_v2.key32 AS bytea CHECK(octet_length(VALUE)=32);
CREATE DOMAIN payment_v2.u64 AS numeric CHECK(VALUE>=0 AND VALUE<=18446744073709551615 AND trunc(VALUE)=VALUE);
CREATE TABLE payment_v2.policies(
 version text PRIMARY KEY,digest payment_v2.key32 UNIQUE NOT NULL,canonical text NOT NULL,
 rules jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(digest=sha256(convert_to(canonical,'UTF8')))
);
INSERT INTO payment_v2.policies(version,digest,canonical,rules) VALUES('MY-USDC-ESCROW-1',decode('834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5','hex'),'[["authenticationBusinessDays",2],["dispatchSeconds",172800],["disputeReviewBusinessDays",5],["eastMalaysiaReviewDays",14],["evidenceGraceSeconds",86400],["manualRefundApproval",true],["peninsularReviewDays",7],["refundPrincipalBps",10000],["rejectionChallengeSeconds",172800],["traceEscalationDays",7],["version","MY-USDC-ESCROW-1"]]','{"version":"MY-USDC-ESCROW-1","dispatchSeconds":172800,"evidenceGraceSeconds":86400,"peninsularReviewDays":7,"eastMalaysiaReviewDays":14,"traceEscalationDays":7,"authenticationBusinessDays":2,"rejectionChallengeSeconds":172800,"disputeReviewBusinessDays":5,"refundPrincipalBps":10000,"manualRefundApproval":true}');
CREATE TABLE payment_v2.networks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),genesis payment_v2.key32 NOT NULL,program payment_v2.key32 NOT NULL,
 config payment_v2.key32 NOT NULL,mint payment_v2.key32 NOT NULL,token_program payment_v2.key32 NOT NULL,
 treasury payment_v2.key32 NOT NULL,treasury_token payment_v2.key32 NOT NULL,issuer payment_v2.key32 NOT NULL,authority_epoch payment_v2.u64 NOT NULL,
 policy_version text NOT NULL REFERENCES payment_v2.policies(version),funding_enabled boolean NOT NULL DEFAULT false,
 max_trade_units payment_v2.u64 NOT NULL DEFAULT 0,max_escrow_units payment_v2.u64 NOT NULL DEFAULT 0,
 UNIQUE(genesis,program),UNIQUE(id,genesis),CHECK(authority_epoch>0)
);
CREATE TABLE payment_v2.staff(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id),
 person_id uuid NOT NULL,role text NOT NULL CHECK(role IN('inventory','receiver','authenticator','reviewer','release','guardian','governor','reconciler')),
 public_key payment_v2.key32 NOT NULL,active boolean NOT NULL DEFAULT true,
 UNIQUE(public_key,role)
);
CREATE UNIQUE INDEX payment_v2_staff_active_assignment ON payment_v2.staff(user_id,role) WHERE active;
-- No automatic enrollment/backfill/activation. Humans attest the EXACT pair, not just SKU equality.
CREATE TABLE payment_v2.inventory(
 card_id uuid PRIMARY KEY REFERENCES public.cards(id),item_id uuid UNIQUE NOT NULL REFERENCES public.items(id),
 card_commitment payment_v2.key32 UNIQUE NOT NULL,pair_commitment payment_v2.key32 UNIQUE NOT NULL,
 custody_version payment_v2.u64 NOT NULL CHECK(custody_version>0),generation payment_v2.u64 NOT NULL DEFAULT 0,
 mode smallint NOT NULL CHECK(mode IN(0,1)),quarantined boolean NOT NULL DEFAULT false,
 enrollment_evidence payment_v2.key32 NOT NULL,enrolled_by uuid NOT NULL REFERENCES payment_v2.staff(id),
 approved_by uuid NOT NULL REFERENCES payment_v2.staff(id),CHECK(enrolled_by<>approved_by),UNIQUE(card_id,item_id)
);
CREATE TABLE payment_v2.wallet_accounts(
 user_id uuid NOT NULL REFERENCES public.users(id),network_id uuid NOT NULL REFERENCES payment_v2.networks(id),
 wallet payment_v2.key32 NOT NULL,token_account payment_v2.key32 NOT NULL,proof_digest payment_v2.key32 NOT NULL,
 PRIMARY KEY(user_id,network_id,wallet),UNIQUE(network_id,token_account)
);
CREATE TABLE payment_v2.sales(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),listing_id uuid NOT NULL REFERENCES public.listings(id),
 card_id uuid NOT NULL REFERENCES payment_v2.inventory(card_id),item_id uuid NOT NULL REFERENCES public.items(id),
 seller_id uuid NOT NULL REFERENCES public.users(id),network_id uuid NOT NULL REFERENCES payment_v2.networks(id),
 sale_commitment payment_v2.key32 UNIQUE NOT NULL,sale_address payment_v2.key32 UNIQUE NOT NULL,
 escrow_address payment_v2.key32 UNIQUE NOT NULL,generation payment_v2.u64 NOT NULL,revision payment_v2.u64 NOT NULL,
 custody_version payment_v2.u64 NOT NULL,mode smallint NOT NULL CHECK(mode IN(0,1)),
 network_snapshot payment_v2.networks NOT NULL,seller_wallet payment_v2.key32 NOT NULL,seller_token payment_v2.key32 NOT NULL,
 price_cents integer NOT NULL CHECK(price_cents>0),policy_version text NOT NULL REFERENCES payment_v2.policies(version),issuer_terms jsonb NOT NULL,
 state text NOT NULL DEFAULT 'opening' CHECK(state IN('opening','open','cancel_requested','funded','direct','released','refunded','revoked')),
 fence boolean NOT NULL DEFAULT true,chain_acknowledged boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(card_id,item_id) REFERENCES payment_v2.inventory(card_id,item_id),UNIQUE(card_id,generation),UNIQUE(id,listing_id,card_id,item_id,seller_id,network_id)
);
CREATE UNIQUE INDEX payment_v2_one_sale_fence ON payment_v2.sales(card_id) WHERE fence;
CREATE UNIQUE INDEX payment_v2_one_listing_sale ON payment_v2.sales(listing_id) WHERE fence;
CREATE TABLE payment_v2.quote_books(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sale_id uuid NOT NULL REFERENCES payment_v2.sales(id),
 total_units payment_v2.u64 NOT NULL CHECK(total_units>0),fx_snapshot jsonb NOT NULL,
 valid_from bigint NOT NULL,expires_at bigint NOT NULL,CHECK(expires_at>valid_from),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_v2.attempts(
 id uuid PRIMARY KEY,idempotency_key uuid NOT NULL,buyer_id uuid NOT NULL REFERENCES public.users(id),
 sale_id uuid NOT NULL,listing_id uuid NOT NULL,card_id uuid NOT NULL,item_id uuid NOT NULL,seller_id uuid NOT NULL,network_id uuid NOT NULL,
 quote_id uuid NOT NULL REFERENCES payment_v2.quote_books(id),attempt_commitment payment_v2.key32 UNIQUE NOT NULL,
 beneficiary payment_v2.key32 NOT NULL,buyer_wallet payment_v2.key32 NOT NULL,seller_wallet payment_v2.key32 NOT NULL,
 buyer_token payment_v2.key32 NOT NULL,seller_token payment_v2.key32 NOT NULL,treasury_token payment_v2.key32 NOT NULL,
 refund_token payment_v2.key32 NOT NULL,policy_version text NOT NULL REFERENCES payment_v2.policies(version),
 total_units payment_v2.u64 NOT NULL,net_units payment_v2.u64 NOT NULL,fee_units payment_v2.u64 NOT NULL,
 gross_cents integer NOT NULL,fee_cents integer NOT NULL,net_cents integer NOT NULL,
 valid_from bigint NOT NULL,expires_at bigint NOT NULL,permit bytea CHECK(permit IS NULL OR octet_length(permit)=690),authorized_by name,authorized_at timestamptz,
 CHECK((permit IS NULL AND authorized_by IS NULL AND authorized_at IS NULL) OR (permit IS NOT NULL AND authorized_by IS NOT NULL AND authorized_at IS NOT NULL)),
 state text NOT NULL DEFAULT 'initiated' CHECK(state IN('initiated','authorized','funded','direct','released','refunded','unresolved')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(buyer_id,idempotency_key),
 FOREIGN KEY(sale_id,listing_id,card_id,item_id,seller_id,network_id) REFERENCES payment_v2.sales(id,listing_id,card_id,item_id,seller_id,network_id),
 CHECK(total_units>0 AND net_units+fee_units=total_units AND fee_units=floor(total_units*500/10000)),
 CHECK(gross_cents>0 AND fee_cents=gross_cents*500::bigint/10000 AND net_cents=gross_cents-fee_cents),
 CHECK(valid_from<expires_at AND buyer_id<>seller_id AND buyer_wallet<>seller_wallet)
);
CREATE TABLE payment_v2.candidates(
 attempt_id uuid NOT NULL REFERENCES payment_v2.attempts(id),signature text NOT NULL CHECK(signature ~ '^[1-9A-HJ-NP-Za-km-z]{80,96}$'),
 submitted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(attempt_id,signature)
);
CREATE TABLE payment_v2.events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL REFERENCES payment_v2.attempts(id),
 sale_id uuid NOT NULL REFERENCES payment_v2.sales(id),kind text NOT NULL CHECK(kind IN('funded','direct','released','refunded')),
 network_id uuid NOT NULL REFERENCES payment_v2.networks(id),genesis payment_v2.key32 NOT NULL,signature text NOT NULL CHECK(signature ~ '^[1-9A-HJ-NP-Za-km-z]{80,96}$'),
 slot bigint NOT NULL CHECK(slot>=0),funded_at bigint NOT NULL,decision_revision payment_v2.u64 NOT NULL,
 proof jsonb NOT NULL,proof_digest payment_v2.key32 NOT NULL,verifier_login name NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(sale_id,kind),UNIQUE(network_id,signature),UNIQUE(genesis,signature),
 FOREIGN KEY(network_id,genesis) REFERENCES payment_v2.networks(id,genesis),
 CHECK((proof->>'finality') IS NOT DISTINCT FROM 'finalized')
);
CREATE UNIQUE INDEX payment_v2_one_funding ON payment_v2.events(sale_id) WHERE kind IN('funded','direct');
CREATE UNIQUE INDEX payment_v2_one_terminal ON payment_v2.events(sale_id) WHERE kind IN('released','refunded');
CREATE TABLE payment_v2.consumptions(
 event_id uuid PRIMARY KEY REFERENCES payment_v2.events(id),order_id uuid NOT NULL REFERENCES public.orders(id),
 result jsonb NOT NULL,consumed_at timestamptz NOT NULL DEFAULT now(),consumed_by name NOT NULL
);
CREATE TABLE payment_v2.escrows(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sale_id uuid UNIQUE NOT NULL REFERENCES payment_v2.sales(id),
 attempt_id uuid UNIQUE NOT NULL REFERENCES payment_v2.attempts(id),order_id uuid UNIQUE NOT NULL REFERENCES public.orders(id),
 funding_event uuid UNIQUE NOT NULL REFERENCES payment_v2.events(id),terminal_event uuid UNIQUE REFERENCES payment_v2.events(id),
 state text NOT NULL CHECK(state IN('funded','released','refunded')),decision_revision payment_v2.u64 NOT NULL DEFAULT 0,
 held boolean NOT NULL DEFAULT false,dispatch_evidence text NOT NULL DEFAULT 'unknown' CHECK(dispatch_evidence IN('unknown','label','carrier_accepted','reviewed_dropoff')),
 dispatch_due timestamptz NOT NULL,review_after timestamptz NOT NULL,received_at timestamptz,
 authentication text NOT NULL DEFAULT 'pending' CHECK(authentication IN('pending','pass','fail'))
);
CREATE TABLE payment_v2.decisions(
 id uuid PRIMARY KEY,escrow_id uuid NOT NULL REFERENCES payment_v2.escrows(id),action text NOT NULL CHECK(action IN('receipt','authentication_pass','authentication_fail','release','refund','dispute','review_authentication_pass','review_authentication_fail','resolve_dispute_release','resolve_dispute_refund')),
 expected_revision payment_v2.u64 NOT NULL,actor_staff uuid NOT NULL REFERENCES payment_v2.staff(id),person_id uuid NOT NULL,
 pair_commitment payment_v2.key32 NOT NULL,evidence_digest payment_v2.key32 NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_v2.governance_approvals(
 decision_id uuid NOT NULL REFERENCES payment_v2.decisions(id),staff_id uuid NOT NULL REFERENCES payment_v2.staff(id),person_id uuid NOT NULL,
 PRIMARY KEY(decision_id,staff_id),UNIQUE(decision_id,person_id)
);
CREATE TABLE payment_v2.attestations(
 decision_id uuid PRIMARY KEY REFERENCES payment_v2.decisions(id),signature text UNIQUE NOT NULL CHECK(signature ~ '^[1-9A-HJ-NP-Za-km-z]{80,96}$'),slot bigint NOT NULL CHECK(slot>=0),
 resulting_revision payment_v2.u64 NOT NULL,proof jsonb NOT NULL,verifier_login name NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_v2.operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),command_id uuid UNIQUE,decision_id uuid UNIQUE REFERENCES payment_v2.decisions(id),
 sale_id uuid NOT NULL REFERENCES payment_v2.sales(id),action text NOT NULL,payload jsonb NOT NULL,
 payload_digest payment_v2.key32 NOT NULL,expected_revision payment_v2.u64 NOT NULL,
 ready boolean NOT NULL DEFAULT true,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','submitted','unknown','observed')),
 lease_id uuid,leased_by name,worker_id uuid,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,
 signature text,resolved_event uuid REFERENCES payment_v2.events(id),last_error text,available_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_v2.outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES payment_v2.events(id),user_id uuid NOT NULL REFERENCES public.users(id),
 kind text NOT NULL,payload jsonb NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','delivered')),
 lease_id uuid,leased_by name,lease_until timestamptz,attempts int NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,last_error text,UNIQUE(event_id,user_id,kind)
);
CREATE TABLE payment_v2.cursors(
 network_id uuid PRIMARY KEY REFERENCES payment_v2.networks(id),after_address text,
 lease_id uuid,leased_by name,lease_until timestamptz,batch_limit integer,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_v2.unresolved(
 id bigserial PRIMARY KEY,network_id uuid NOT NULL REFERENCES payment_v2.networks(id),sale_address text NOT NULL,
 error text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_v2.lifecycle_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sale_id uuid NOT NULL REFERENCES payment_v2.sales(id),
 kind text NOT NULL CHECK(kind IN('opened','revoked','acknowledged')),proof jsonb NOT NULL,signature text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(sale_id,kind)
);
CREATE TABLE payment_v2.usdc_journal(
 id bigserial PRIMARY KEY,event_id uuid NOT NULL REFERENCES payment_v2.events(id),network_id uuid NOT NULL REFERENCES payment_v2.networks(id),
 mint payment_v2.key32 NOT NULL,account text NOT NULL,units numeric NOT NULL CHECK(trunc(units)=units AND units<>0 AND abs(units)<=18446744073709551615),
 UNIQUE(event_id,account)
);
ALTER TABLE public.orders ADD COLUMN payment_rail text NOT NULL DEFAULT 'legacy_unverified'
 CHECK(payment_rail IN('legacy_unverified','solana_v2_escrow','solana_v2_direct'));
ALTER TABLE public.orders ADD COLUMN payment_v2_attempt_id uuid UNIQUE REFERENCES payment_v2.attempts(id);
-- No sol:-prefix backfill. Historical orders, references, paid_out and transfers stay as-is.

CREATE FUNCTION payment_v2.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'PAYMENT_V2_IMMUTABLE: %',TG_TABLE_NAME; END $$;
DO $tables$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['policies','wallet_accounts','quote_books','candidates','events','consumptions','decisions','governance_approvals','attestations','lifecycle_evidence','usdc_journal'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.%I FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable()',n);
 END LOOP;
 -- Mutable state/tombstones may never be deleted, even by workers.
 FOREACH n IN ARRAY ARRAY['inventory','networks','staff','sales','attempts','escrows','operations','outbox','cursors','unresolved'] LOOP
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON payment_v2.%I FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable()',n);
 END LOOP;
END $tables$;
CREATE FUNCTION payment_v2.journal_balanced() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,payment_v2 AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM payment_v2.usdc_journal WHERE event_id=NEW.event_id GROUP BY network_id,mint HAVING sum(units)<>0) THEN
  RAISE EXCEPTION 'PAYMENT_V2_USDC_UNBALANCED';
 END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER usdc_balanced AFTER INSERT ON payment_v2.usdc_journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_v2.journal_balanced();
-- No functions/grants are exposed until the final migration completes its hardening.
REVOKE ALL ON ALL TABLES IN SCHEMA payment_v2 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA payment_v2 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
