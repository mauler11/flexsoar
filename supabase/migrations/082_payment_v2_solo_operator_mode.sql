-- ============================================================================
-- 082_payment_v2_solo_operator_mode.sql
--
-- Solo-operator mode, per docs/handoff/solo-operator-design.md (S1, founder
-- decisions 2026-10-22). Requires 081 applied and funding disabled on every
-- network. One transaction. No arity change to any existing function.
--
-- 1. payment_v2.governance_mode: one row, (operational_separation,
--    governors_required, release_delay_seconds). Initial value
--    ('separated', 3, 0) = today's behaviour; every existing rule is
--    unchanged until two governors switch it. Audited into
--    configuration_history (063 audit_configuration). CHECK: 'solo' requires
--    governors_required=2 and release_delay_seconds>=86400.
-- 2. Governance RPCs (authenticated; owner payment_v2_owner; definer):
--      fn_payment_v2_propose_governance(kind, payload) -> proposal id
--        kind 'mode' {separation, governors, delaySeconds}, refused while any
--        network has funding enabled; kind 'enable_funding' {networkId}.
--        The proposer must be an active governor and counts as approval 1.
--      fn_payment_v2_approve_governance(proposal) -> jsonb
--        a governor of a DIFFERENT person approves; at 2 distinct active
--        governor persons the proposal is applied once: 'mode' only if the
--        mode is still the one proposed against and funding is off;
--        'enable_funding' only if funding_configuration holds.
--      fn_payment_v2_disable_funding() -> networks disabled
--        any single active guardian OR governor; only ever turns funding off.
--    Proposals, approvals and applications are immutable rows.
-- 3. decisions.mode_at_decision (nullable for history): record_decision
--    stamps the mode in force.
-- 4. Fragment repairs (single-line, CR-tolerant, self-relative as 074-081):
--      funding_configuration (060:19-27): governors exactly G rows and G
--        persons; 7+G distinct keys; 4 operational persons only in
--        'separated'; 'solo' requires the 24 h delay.
--      reconcile_event (061:67-70): person checks -> payment_v2.independent_actor
--        (persons in 'separated', keys in 'solo') judged by the mode STAMPED on
--        the release decision, so a mode switch never strands an in-flight
--        release; a 'solo' release also needs its on-chain execution >= 86400 s
--        (the solo floor) after the authentication attestation (RELEASE_DELAY).
--      record_decision (067:32-34): same helper under the current mode (message
--        INDEPENDENT_PERSON_REQUIRED / INDEPENDENT_KEY_REQUIRED); RELEASE_DELAY
--        for 'release' under the current delay; mode_at_decision stamped.
--      correspondence (063:46): inventory enrolment independence via the helper
--        under the current mode on INSERT; on UPDATE (the pair is immutable)
--        either mode's independence is accepted, so a later mode switch never
--        blocks quarantining a row enrolled under the other mode.
--      approve_refund (061:148): governor set must be exactly G persons.
--    In 'separated' mode with delay 0 every repaired check is equivalent to
--    the old one for every row that exists before 082 (the correspondence
--    UPDATE relaxation only matters for rows enrolled under 'solo'); the
--    postguard proves funding_configuration is unchanged for
--    every network.
-- Program-side changes (release delay, seller floor, governance) ship
-- separately in the single program upgrade.
-- ============================================================================

BEGIN;

-- The migration role must act as payment_v2_owner (staging/production: postgres is a SET+INHERIT member since 059 ran with
-- createrole_self_grant='set, inherit'). Checked first so a wrong role fails with this message, not a permission error.
DO $role$
BEGIN
 IF NOT pg_has_role(current_user,'payment_v2_owner','SET') OR NOT pg_has_role(current_user,'payment_v2_owner','USAGE') THEN
  RAISE EXCEPTION '082: % cannot SET ROLE / inherit payment_v2_owner; run as the role that applied 059-081',current_user;
 END IF;
END $role$;

CREATE TEMP TABLE m082_before ON COMMIT DROP AS
 SELECT fn.oid, fn.oid::regprocedure::text AS sig, fn.proowner, fn.proacl, fn.prosecdef, fn.proconfig, fn.provolatile,
  fn.proisstrict, fn.proparallel, fn.proleakproof, pg_get_function_identity_arguments(fn.oid) AS identity_args,
  pg_get_function_result(fn.oid) AS result_type, to_jsonb(fn)-'prosrc' AS metadata, fn.prosrc, f.frag_old, f.frag_new, f.ord, f.pin
 FROM (VALUES
  (1,'payment_v2.funding_configuration(uuid)','acf12f3b68d0d34e5b50eecc00c5bdc5',
   $f$ AND (SELECT count(1)=3 AND count(DISTINCT person_id)=3 FROM payment_v2.staff WHERE role='governor' AND active)$f$,
   $f$ AND (SELECT count(1)=(SELECT governors_required FROM payment_v2.governance_mode) AND count(DISTINCT person_id)=(SELECT governors_required FROM payment_v2.governance_mode) FROM payment_v2.staff WHERE role='governor' AND active)$f$),
  (2,'payment_v2.funding_configuration(uuid)','acf12f3b68d0d34e5b50eecc00c5bdc5',
   $f$ AND (SELECT count(DISTINCT public_key)=10 FROM payment_v2.staff WHERE active)$f$,
   $f$ AND (SELECT count(DISTINCT public_key)=7+(SELECT governors_required FROM payment_v2.governance_mode) FROM payment_v2.staff WHERE active)$f$),
  (3,'payment_v2.funding_configuration(uuid)','acf12f3b68d0d34e5b50eecc00c5bdc5',
   $f$ AND (SELECT count(DISTINCT person_id)=4 FROM payment_v2.staff WHERE active AND role IN('receiver','authenticator','reviewer','release')))$f$,
   $f$ AND CASE (SELECT operational_separation FROM payment_v2.governance_mode) WHEN 'separated' THEN (SELECT count(DISTINCT person_id)=4 FROM payment_v2.staff WHERE active AND role IN('receiver','authenticator','reviewer','release')) WHEN 'solo' THEN (SELECT release_delay_seconds>=86400 FROM payment_v2.governance_mode) ELSE false END)$f$),
  (1,'public.fn_payment_v2_reconcile_event(uuid)','db6edf3353edc291be17a86f6961610d',
   $f$AND ad.action IN('authentication_pass','review_authentication_pass') AND ad.person_id<>d.person_id)$f$,
   $f$AND ad.action IN('authentication_pass','review_authentication_pass') AND payment_v2.independent_actor((SELECT md.mode_at_decision FROM payment_v2.decisions md WHERE md.id=d.id),ad.person_id,ad.actor_staff,d.person_id,d.actor_staff))$f$),
  (2,'public.fn_payment_v2_reconcile_event(uuid)','db6edf3353edc291be17a86f6961610d',
   $f$WHERE rd.escrow_id=x.id AND rd.action='receipt' AND rd.person_id=d.person_id) THEN RAISE EXCEPTION 'PAYMENT_V2_ACCEPTANCE_REQUIRED';END IF;$f$,
   $f$WHERE rd.escrow_id=x.id AND rd.action='receipt' AND NOT payment_v2.independent_actor((SELECT md.mode_at_decision FROM payment_v2.decisions md WHERE md.id=d.id),rd.person_id,rd.actor_staff,d.person_id,d.actor_staff)) THEN RAISE EXCEPTION 'PAYMENT_V2_ACCEPTANCE_REQUIRED';END IF; IF NOT payment_v2.release_delay_met(x.id,(SELECT max((rt.proof->>'executedAtSeconds')::bigint) FROM payment_v2.attestations rt WHERE rt.decision_id=d.id),CASE (SELECT md.mode_at_decision FROM payment_v2.decisions md WHERE md.id=d.id) WHEN 'solo' THEN 86400 ELSE 0 END) THEN RAISE EXCEPTION 'PAYMENT_V2_RELEASE_DELAY';END IF;$f$),
  (1,'public.fn_payment_v2_record_decision(jsonb)','b39743787b470eaf8bae4d6850666060',
   $f$WHERE prev.escrow_id=x.id AND prev.person_id=st.person_id AND prev.action IN('receipt','authentication_pass','authentication_fail','review_authentication_pass','review_authentication_fail')) THEN RAISE EXCEPTION 'PAYMENT_V2_INDEPENDENT_PERSON_REQUIRED';END IF;$f$,
   $f$WHERE prev.escrow_id=x.id AND NOT payment_v2.independent_actor((SELECT operational_separation FROM payment_v2.governance_mode),prev.person_id,prev.actor_staff,st.person_id,st.id) AND prev.action IN('receipt','authentication_pass','authentication_fail','review_authentication_pass','review_authentication_fail')) THEN RAISE EXCEPTION '%',CASE (SELECT operational_separation FROM payment_v2.governance_mode) WHEN 'solo' THEN 'PAYMENT_V2_INDEPENDENT_KEY_REQUIRED' ELSE 'PAYMENT_V2_INDEPENDENT_PERSON_REQUIRED' END;END IF; IF action='release' AND NOT payment_v2.release_delay_met(x.id,extract(epoch FROM clock_timestamp())::bigint,(SELECT release_delay_seconds FROM payment_v2.governance_mode)) THEN RAISE EXCEPTION 'PAYMENT_V2_RELEASE_DELAY';END IF;$f$),
  (2,'public.fn_payment_v2_record_decision(jsonb)','b39743787b470eaf8bae4d6850666060',
   $f$decode(p_decision->>'evidenceDigest','hex'),p_decision,now());$f$,
   $f$decode(p_decision->>'evidenceDigest','hex'),p_decision,now(),(SELECT operational_separation FROM payment_v2.governance_mode));$f$),
  (1,'payment_v2.correspondence()','bb694b168d7742fa9a70211783f707ac',
   $f$AND a.role='inventory' AND b.role='reviewer' AND a.person_id<>b.person_id$f$,
   $f$AND a.role='inventory' AND b.role='reviewer' AND CASE TG_OP WHEN 'INSERT' THEN payment_v2.independent_actor((SELECT operational_separation FROM payment_v2.governance_mode),a.person_id,a.id,b.person_id,b.id) ELSE payment_v2.independent_actor('separated',a.person_id,a.id,b.person_id,b.id) OR payment_v2.independent_actor('solo',a.person_id,a.id,b.person_id,b.id) END$f$),
  (1,'public.fn_payment_v2_approve_refund(uuid)','da1c77135458064ea339c4adbf628e88',
   $f$WHERE role='governor' AND active)<>3 THEN RAISE EXCEPTION 'PAYMENT_V2_THREE_GOVERNORS_REQUIRED';END IF;$f$,
   $f$WHERE role='governor' AND active)<>(SELECT governors_required FROM payment_v2.governance_mode) THEN RAISE EXCEPTION '%',CASE (SELECT governors_required FROM payment_v2.governance_mode) WHEN 3 THEN 'PAYMENT_V2_THREE_GOVERNORS_REQUIRED' ELSE 'PAYMENT_V2_GOVERNOR_SET_INCOMPLETE' END;END IF;$f$)
 ) f(ord,sig,pin,frag_old,frag_new)
 JOIN pg_proc fn ON fn.oid=f.sig::regprocedure;

-- funding_configuration for every network, before (must be identical after: the initial mode is 'separated', 3, 0).
CREATE TEMP TABLE m082_fc ON COMMIT DROP AS SELECT n.id, payment_v2.funding_configuration(n.id) AS ok FROM payment_v2.networks n;

DO $preguard$
DECLARE r record;v_n bigint;
BEGIN
 IF (SELECT count(*) FROM m082_before)<>9 OR (SELECT count(DISTINCT oid) FROM m082_before)<>5 THEN
  RAISE EXCEPTION '082: snapshot captured % fragment rows over % functions, expected 9 over 5',(SELECT count(*) FROM m082_before),(SELECT count(DISTINCT oid) FROM m082_before);
 END IF;
 FOR r IN SELECT DISTINCT oid,sig,pin FROM m082_before LOOP
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=r.oid) AND proname=(SELECT proname FROM pg_proc WHERE oid=r.oid);
  IF v_n<>1 THEN RAISE EXCEPTION '082: expected exactly one % overload, found %',r.sig,v_n;END IF;
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=r.oid)<>r.pin THEN
   RAISE EXCEPTION '082: % is not the expected body (found md5 %)',r.sig,(SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=r.oid);
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM m082_before LOOP
  IF position(E'\n' IN r.frag_old||r.frag_new)>0 OR position(E'\r' IN r.frag_old||r.frag_new)>0 THEN RAISE EXCEPTION '082: fragments must be single-line';END IF;
  IF position(r.frag_new IN r.prosrc)>0 THEN RAISE EXCEPTION '082: % already carries the 082 fragment %',r.sig,r.ord;END IF;
  IF (length(r.prosrc)-length(replace(r.prosrc,r.frag_old,'')))/length(r.frag_old)<>1 THEN
   RAISE EXCEPTION '082: fragment % of % must occur exactly once (found %)',r.ord,r.sig,(length(r.prosrc)-length(replace(r.prosrc,r.frag_old,'')))/length(r.frag_old);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM m082_before WHERE proowner<>'payment_v2_owner'::regrole) THEN RAISE EXCEPTION '082: a repaired function is not owned by payment_v2_owner';END IF;
 -- 081 applied.
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.fn_set_card_visibility(uuid,boolean)'::regprocedure AND a.grantee=0::oid)
  OR has_function_privilege('anon','public.fn_set_card_visibility(uuid,boolean)','EXECUTE') THEN
  RAISE EXCEPTION '082: 081 is not applied';
 END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION '082: funding must be disabled on every network';END IF;
 IF has_schema_privilege('payment_v2_owner','public','CREATE') THEN RAISE EXCEPTION '082: payment_v2_owner already has CREATE on public (069b state expected); inspect first';END IF;
 IF to_regclass('payment_v2.governance_mode') IS NOT NULL OR to_regclass('payment_v2.governance_proposals') IS NOT NULL
  OR to_regclass('payment_v2.governance_proposal_approvals') IS NOT NULL OR to_regclass('payment_v2.governance_proposal_applied') IS NOT NULL
  OR to_regprocedure('payment_v2.independent_actor(text,uuid,uuid,uuid,uuid)') IS NOT NULL OR to_regprocedure('payment_v2.release_delay_met(uuid,bigint,integer)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_propose_governance(text,jsonb)') IS NOT NULL OR to_regprocedure('public.fn_payment_v2_approve_governance(uuid)') IS NOT NULL
  OR to_regprocedure('public.fn_payment_v2_disable_funding()') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='payment_v2.decisions'::regclass AND attname='mode_at_decision' AND NOT attisdropped) THEN
  RAISE EXCEPTION '082: solo-mode objects already exist';
 END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='payment_v2.decisions'::regclass AND attnum>0 AND NOT attisdropped)<>10 THEN
  RAISE EXCEPTION '082: payment_v2.decisions does not have the 10 columns record_decision inserts positionally';
 END IF;
END $preguard$;

-- 1. Mode and governance records (owned by payment_v2_owner, like every payment_v2 table).
SET LOCAL ROLE payment_v2_owner;
CREATE TABLE payment_v2.governance_mode(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton),
 operational_separation text NOT NULL CHECK(operational_separation IN('separated','solo')),
 governors_required smallint NOT NULL CHECK(governors_required IN(2,3)),
 release_delay_seconds integer NOT NULL CHECK(release_delay_seconds>=0),
 CHECK(operational_separation='separated' OR (governors_required=2 AND release_delay_seconds>=86400))
);
CREATE TABLE payment_v2.governance_proposals(
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN('mode','enable_funding')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 base_mode jsonb NOT NULL,
 proposed_by uuid NOT NULL REFERENCES payment_v2.staff(id),
 proposed_person uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE payment_v2.governance_proposal_approvals(
 proposal_id uuid NOT NULL REFERENCES payment_v2.governance_proposals(id),
 staff_id uuid NOT NULL REFERENCES payment_v2.staff(id),
 person_id uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(proposal_id,person_id)
);
CREATE TABLE payment_v2.governance_proposal_applied(
 proposal_id uuid PRIMARY KEY REFERENCES payment_v2.governance_proposals(id),
 applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE payment_v2.decisions ADD COLUMN mode_at_decision text CHECK(mode_at_decision IN('separated','solo'));
RESET ROLE;
DO $tables$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['governance_mode','governance_proposals','governance_proposal_approvals','governance_proposal_applied'] LOOP
  EXECUTE format('ALTER TABLE payment_v2.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON payment_v2.%I FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier',n);
 END LOOP;
END $tables$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.governance_proposals FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.governance_proposal_approvals FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_v2.governance_proposal_applied FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE TRIGGER no_delete BEFORE DELETE ON payment_v2.governance_mode FOR EACH ROW EXECUTE FUNCTION payment_v2.immutable();
CREATE TRIGGER audit_configuration AFTER INSERT OR UPDATE ON payment_v2.governance_mode FOR EACH ROW EXECUTE FUNCTION payment_v2.audit_configuration();
INSERT INTO payment_v2.governance_mode(operational_separation,governors_required,release_delay_seconds) VALUES('separated',3,0);

-- 2. Helpers (invoker; called from owner-definer functions and the owner-only correspondence trigger).
SET LOCAL ROLE payment_v2_owner;
-- independent_actor(mode, person A, staff A, person B, staff B): the mode is passed explicitly so reconcile can judge a release
-- by the mode stamped on its decision (NULL = pre-082 history = 'separated'), never by a mode switched while it was in flight.
-- 'separated': different persons (exactly the old person_id<>person_id; both columns are NOT NULL). 'solo': different keys.
CREATE FUNCTION payment_v2.independent_actor(p_mode text,p_person_a uuid,p_staff_a uuid,p_person_b uuid,p_staff_b uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(CASE coalesce(p_mode,'separated')
  WHEN 'separated' THEN p_person_a<>p_person_b
  WHEN 'solo' THEN (SELECT a.public_key<>b.public_key FROM payment_v2.staff a,payment_v2.staff b WHERE a.id=p_staff_a AND b.id=p_staff_b) END,false)
$$;
-- release_delay_met(escrow, at, delay): the latest authentication attestation executed at least <delay> seconds before <at>.
CREATE FUNCTION payment_v2.release_delay_met(p_escrow uuid,p_at bigint,p_delay integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_delay=0 THEN true
  ELSE coalesce((SELECT max((t.proof->>'executedAtSeconds')::bigint) FROM payment_v2.decisions d JOIN payment_v2.attestations t ON t.decision_id=d.id
    WHERE d.escrow_id=p_escrow AND d.action IN('authentication_pass','review_authentication_pass'))+p_delay<=p_at,false) END
$$;
RESET ROLE;
REVOKE ALL ON FUNCTION payment_v2.independent_actor(text,uuid,uuid,uuid,uuid),payment_v2.release_delay_met(uuid,bigint,integer) FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;

-- 3. Governance RPCs.
CREATE FUNCTION public.fn_payment_v2_propose_governance(p_kind text,p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE st payment_v2.staff%rowtype;v_id uuid:=gen_random_uuid();v_sep text;v_gov integer;v_delay integer;
BEGIN
 SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE user_id=payment_v2.actor() AND role='governor' AND active;
 IF st.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNOR_REQUIRED' USING ERRCODE='42501';END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_PAYLOAD';END IF;
 IF p_kind='mode' THEN
  IF NOT (p_payload ?& ARRAY['separation','governors','delaySeconds']) OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>3
   OR jsonb_typeof(p_payload->'governors')<>'number' OR jsonb_typeof(p_payload->'delaySeconds')<>'number' THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_MODE_INVALID';END IF;
  v_sep:=p_payload->>'separation';v_gov:=(p_payload->>'governors')::integer;v_delay:=(p_payload->>'delaySeconds')::integer;
  IF v_sep NOT IN('separated','solo') OR v_gov NOT IN(2,3) OR v_delay<0 OR (v_sep='solo' AND (v_gov<>2 OR v_delay<86400)) THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_MODE_INVALID';END IF;
  IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION 'PAYMENT_V2_FUNDING_ENABLED';END IF;
 ELSIF p_kind='enable_funding' THEN
  IF NOT (p_payload ? 'networkId') OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>1
   OR NOT EXISTS(SELECT 1 FROM payment_v2.networks WHERE id=(p_payload->>'networkId')::uuid AND NOT funding_enabled) THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_NETWORK';END IF;
 ELSE RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_KIND';
 END IF;
 INSERT INTO payment_v2.governance_proposals(id,kind,payload,base_mode,proposed_by,proposed_person)
 VALUES(v_id,p_kind,p_payload,(SELECT to_jsonb(g)-'id'-'singleton' FROM payment_v2.governance_mode g),st.id,st.person_id);
 INSERT INTO payment_v2.governance_proposal_approvals(proposal_id,staff_id,person_id) VALUES(v_id,st.id,st.person_id);
 RETURN v_id;
END $$;

CREATE FUNCTION public.fn_payment_v2_approve_governance(p_proposal uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE st payment_v2.staff%rowtype;p payment_v2.governance_proposals%rowtype;v_n integer;v_net uuid;
BEGIN
 SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE user_id=payment_v2.actor() AND role='governor' AND active;
 IF st.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNOR_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT id,kind,payload,base_mode,proposed_by,proposed_person,created_at INTO p.id,p.kind,p.payload,p.base_mode,p.proposed_by,p.proposed_person,p.created_at
  FROM payment_v2.governance_proposals WHERE id=p_proposal FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_PROPOSAL_MISSING';END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.governance_proposal_applied WHERE proposal_id=p.id) THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_ALREADY_APPLIED';END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.governance_proposal_approvals WHERE proposal_id=p.id AND person_id=st.person_id) THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_SAME_PERSON';END IF;
 INSERT INTO payment_v2.governance_proposal_approvals(proposal_id,staff_id,person_id) VALUES(p.id,st.id,st.person_id);
 -- Only approvals by governors that are still active count.
 SELECT count(DISTINCT a.person_id) INTO v_n FROM payment_v2.governance_proposal_approvals a JOIN payment_v2.staff s ON s.id=a.staff_id
  WHERE a.proposal_id=p.id AND s.role='governor' AND s.active;
 IF v_n<2 THEN RETURN jsonb_build_object('proposalId',p.id,'approvals',v_n,'applied',false);END IF;
 IF p.kind='mode' THEN
  IF (SELECT to_jsonb(g)-'id'-'singleton' FROM payment_v2.governance_mode g) IS DISTINCT FROM p.base_mode THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_STALE';END IF;
  IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION 'PAYMENT_V2_FUNDING_ENABLED';END IF;
  UPDATE payment_v2.governance_mode SET operational_separation=p.payload->>'separation',governors_required=(p.payload->>'governors')::smallint,
   release_delay_seconds=(p.payload->>'delaySeconds')::integer;
 ELSE
  v_net:=(p.payload->>'networkId')::uuid;
  PERFORM 1 FROM payment_v2.networks WHERE id=v_net FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM payment_v2.networks WHERE id=v_net AND NOT funding_enabled) THEN RAISE EXCEPTION 'PAYMENT_V2_GOVERNANCE_STALE';END IF;
  IF NOT payment_v2.funding_configuration(v_net) THEN RAISE EXCEPTION 'PAYMENT_V2_NOT_CONFIGURED';END IF;
  UPDATE payment_v2.networks SET funding_enabled=true WHERE id=v_net;
 END IF;
 INSERT INTO payment_v2.governance_proposal_applied(proposal_id) VALUES(p.id);
 RETURN jsonb_build_object('proposalId',p.id,'approvals',v_n,'applied',true);
END $$;

CREATE FUNCTION public.fn_payment_v2_disable_funding() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_v2.staff WHERE user_id=payment_v2.actor() AND role IN('guardian','governor') AND active) THEN
  RAISE EXCEPTION 'PAYMENT_V2_GUARDIAN_OR_GOVERNOR_REQUIRED' USING ERRCODE='42501';
 END IF;
 UPDATE payment_v2.networks SET funding_enabled=false WHERE funding_enabled;
 GET DIAGNOSTICS v_n = ROW_COUNT;
 RETURN v_n;
END $$;

-- OWNER TO needs the new owner to hold CREATE on public (067b/069b). The grant exists only inside this transaction and the
-- postguard asserts it is gone before COMMIT.
GRANT CREATE ON SCHEMA public TO payment_v2_owner;
DO $rpc_owner$ DECLARE f text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.fn_payment_v2_propose_governance(text,jsonb)','public.fn_payment_v2_approve_governance(uuid)','public.fn_payment_v2_disable_funding()'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO payment_v2_owner',f);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);
 END LOOP;
END $rpc_owner$;
REVOKE CREATE ON SCHEMA public FROM payment_v2_owner;

-- 4. Fragment repairs.
DO $repair$
DECLARE r record;v_def text;f record;
BEGIN
 FOR r IN SELECT DISTINCT oid,sig FROM m082_before LOOP
  SELECT pg_get_functiondef(r.oid) INTO v_def;
  FOR f IN SELECT frag_old,frag_new FROM m082_before WHERE oid=r.oid ORDER BY ord LOOP
   IF (length(v_def)-length(replace(v_def,f.frag_old,'')))/length(f.frag_old)<>1 THEN
    RAISE EXCEPTION '082: fragment not found exactly once in pg_get_functiondef(%)',r.sig;
   END IF;
   v_def:=replace(v_def,f.frag_old,f.frag_new);
  END LOOP;
  EXECUTE v_def;
 END LOOP;
END $repair$;

DO $postguard$
DECLARE r record;v_src text;v_n bigint;
BEGIN
 FOR r IN SELECT DISTINCT oid,sig,proowner,proacl,prosecdef,proconfig,provolatile,proisstrict,proparallel,proleakproof,identity_args,result_type,metadata FROM m082_before LOOP
  SELECT prosrc INTO v_src FROM m082_before WHERE oid=r.oid LIMIT 1;
  FOR v_n IN SELECT ord FROM m082_before WHERE oid=r.oid ORDER BY ord LOOP
   v_src:=replace(v_src,(SELECT frag_old FROM m082_before WHERE oid=r.oid AND ord=v_n),(SELECT frag_new FROM m082_before WHERE oid=r.oid AND ord=v_n));
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_proc live WHERE live.oid=r.oid AND live.oid=r.sig::regprocedure
    AND live.proowner=r.proowner AND live.proacl IS NOT DISTINCT FROM r.proacl AND live.prosecdef=r.prosecdef
    AND live.proconfig IS NOT DISTINCT FROM r.proconfig AND live.provolatile=r.provolatile AND live.proisstrict=r.proisstrict
    AND live.proparallel=r.proparallel AND live.proleakproof=r.proleakproof
    AND pg_get_function_identity_arguments(live.oid)=r.identity_args AND pg_get_function_result(live.oid)=r.result_type
    AND (to_jsonb(live)-'prosrc') IS NOT DISTINCT FROM r.metadata AND live.prosrc=v_src) THEN
   RAISE EXCEPTION '082: % changed beyond its permitted fragment substitutions; rolling back',r.sig;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=r.oid) AND proname=(SELECT proname FROM pg_proc WHERE oid=r.oid);
  IF v_n<>1 THEN RAISE EXCEPTION '082: overload count for % is % after repair',r.sig,v_n;END IF;
 END LOOP;
 -- Initial mode is today's behaviour, recorded once in configuration_history.
 IF (SELECT count(*) FROM payment_v2.governance_mode)<>1
  OR NOT EXISTS(SELECT 1 FROM payment_v2.governance_mode WHERE operational_separation='separated' AND governors_required=3 AND release_delay_seconds=0) THEN
  RAISE EXCEPTION '082: governance_mode is not exactly (separated, 3, 0)';
 END IF;
 IF (SELECT count(*) FROM payment_v2.configuration_history WHERE entity='governance_mode')<>1 THEN RAISE EXCEPTION '082: governance_mode insert was not audited';END IF;
 -- funding_configuration unchanged for every network.
 IF EXISTS(SELECT 1 FROM m082_fc b WHERE payment_v2.funding_configuration(b.id) IS DISTINCT FROM b.ok) THEN
  RAISE EXCEPTION '082: funding_configuration changed for a network under the initial separated mode';
 END IF;
 -- New tables: owner, RLS on, no client or worker grants.
 FOR r IN SELECT c.oid,c.relname,c.relowner,c.relrowsecurity FROM pg_class c WHERE c.relnamespace='payment_v2'::regnamespace
   AND c.relname IN('governance_mode','governance_proposals','governance_proposal_approvals','governance_proposal_applied') LOOP
  IF r.relowner<>'payment_v2_owner'::regrole OR NOT r.relrowsecurity THEN RAISE EXCEPTION '082: % owner/RLS state wrong',r.relname;END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','payment_v2_issuer','payment_v2_verifier','payment_v2_settler','payment_v2_executor','payment_v2_notifier']) g(role)
    WHERE has_table_privilege(g.role,r.oid,'SELECT') OR has_table_privilege(g.role,r.oid,'INSERT') OR has_table_privilege(g.role,r.oid,'UPDATE') OR has_table_privilege(g.role,r.oid,'DELETE')) THEN
   RAISE EXCEPTION '082: a client or worker role has privileges on payment_v2.%',r.relname;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='payment_v2'::regnamespace AND relname IN('governance_mode','governance_proposals','governance_proposal_approvals','governance_proposal_applied'))<>4 THEN
  RAISE EXCEPTION '082: governance tables missing';
 END IF;
 -- New functions: owner, definer/search_path, ACL exact.
 FOR r IN SELECT p.oid,p.oid::regprocedure::text AS sig,p.proowner,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p WHERE p.oid IN(
   'payment_v2.independent_actor(text,uuid,uuid,uuid,uuid)'::regprocedure,'payment_v2.release_delay_met(uuid,bigint,integer)'::regprocedure,
   'public.fn_payment_v2_propose_governance(text,jsonb)'::regprocedure,'public.fn_payment_v2_approve_governance(uuid)'::regprocedure,
   'public.fn_payment_v2_disable_funding()'::regprocedure) LOOP
  IF r.proowner<>'payment_v2_owner'::regrole OR r.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN RAISE EXCEPTION '082: % owner/search_path wrong',r.sig;END IF;
  IF r.sig LIKE 'payment_v2.%' THEN
   IF r.prosecdef OR has_function_privilege('authenticated',r.oid,'EXECUTE') OR has_function_privilege('anon',r.oid,'EXECUTE') THEN RAISE EXCEPTION '082: helper % must be invoker and not client-executable',r.sig;END IF;
  ELSE
   IF NOT r.prosecdef OR NOT has_function_privilege('authenticated',r.oid,'EXECUTE') OR has_function_privilege('anon',r.oid,'EXECUTE')
    OR has_function_privilege('service_role',r.oid,'EXECUTE')
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['payment_v2_issuer','payment_v2_verifier','payment_v2_settler','payment_v2_executor','payment_v2_notifier']) w(role) WHERE has_function_privilege(w.role,r.oid,'EXECUTE')) THEN
    RAISE EXCEPTION '082: RPC % must be definer and executable by authenticated only',r.sig;
   END IF;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='payment_v2.decisions'::regclass AND attname='mode_at_decision' AND attnum=11 AND NOT attnotnull AND NOT atthasdef) THEN
  RAISE EXCEPTION '082: decisions.mode_at_decision is not the nullable 11th column';
 END IF;
 IF has_schema_privilege('payment_v2_owner','public','CREATE') THEN RAISE EXCEPTION '082: payment_v2_owner still has CREATE on public';END IF;
END $postguard$;

COMMIT;
