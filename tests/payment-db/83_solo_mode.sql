-- 082 solo-operator mode: refusal and acceptance suite. psql only, never npm/test discovery.
-- Runs as the test administrator on flexsoar_payment_v2_test with 078..082 applied. One transaction, rolled back.
-- Stages: S separated (the initial mode keeps every old refusal), G governance RPCs, O solo, R round trip.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
DO $pre$ BEGIN
 IF to_regclass('payment_v2.governance_mode') IS NULL THEN RAISE EXCEPTION 'apply 082 first';END IF;
END $pre$;

CREATE TEMP TABLE fx(name text PRIMARY KEY,f jsonb NOT NULL);
CREATE TEMP TABLE sx(name text PRIMARY KEY,id uuid NOT NULL);
CREATE FUNCTION pg_temp.f(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT f FROM fx WHERE name=p $$;
CREATE FUNCTION pg_temp.s(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sx WHERE name=p $$;
CREATE FUNCTION pg_temp.act(p_staff uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub',(SELECT user_id::text FROM payment_v2.staff WHERE id=p_staff),true);END $$;
CREATE FUNCTION pg_temp.new_user() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.users(id,auth_id,handle,email,country_code) VALUES(u,u,'m82-'||left(replace(u::text,'-',''),20),'m82-'||u||'@example.invalid','MY');RETURN u;
END $$;
-- staff(name, user, person, role, key): key NULL = a fresh distinct key.
CREATE FUNCTION pg_temp.staff(p_name text,p_user uuid,p_person uuid,p_role text,p_key bytea DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE st uuid:=gen_random_uuid();
BEGIN
 INSERT INTO payment_v2.staff(id,user_id,person_id,role,public_key) VALUES(st,p_user,p_person,p_role,coalesce(p_key,sha256(uuid_send(st))));
 INSERT INTO sx VALUES(p_name,st);RETURN st;
END $$;
-- decide(fixture, action, staff): record the decision as that staff member; returns the command.
CREATE FUNCTION pg_temp.decide(f jsonb,a text,p_staff uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE x uuid;rev numeric;d jsonb;
BEGIN
 SELECT id,decision_revision INTO x,rev FROM payment_v2.escrows WHERE attempt_id=(f->>'attempt')::uuid;
 PERFORM pg_temp.act(p_staff);
 d:=jsonb_build_object('escrowId',x,'commandId',gen_random_uuid(),'expectedRevision',rev::text,'action',a,'evidenceDigest',repeat('ab',32),'refundReason','approved_loss','pairCommitment',encode(sha256(uuid_send((f->>'item')::uuid)),'hex'));
 PERFORM public.fn_payment_v2_record_decision(d);RETURN d;
END $$;
-- attest(fixture, command, seq, executedAtSeconds): the decision's finalized attestation, with retained evidence (068).
CREATE FUNCTION pg_temp.attest_at(f jsonb,d jsonb,seq integer,executed bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k bytea;a text:=d->>'action';p jsonb;
BEGIN
 SELECT st.public_key INTO k FROM payment_v2.decisions dec JOIN payment_v2.staff st ON st.id=dec.actor_staff WHERE dec.id=(d->>'commandId')::uuid;
 p:=jsonb_build_object('commandId',d->>'commandId','finality','finalized','sale',f->'proof'->>'sale','genesis',f->'proof'->>'genesis','program',f->'proof'->>'program','action',a,'evidenceDigest',d->>'evidenceDigest','pairCommitment',d->>'pairCommitment','signature',payment_v2.b58(sha512(uuid_send((d->>'commandId')::uuid))),'slot',seq+10,'executedAtSeconds',executed,'resultingRevision',((d->>'expectedRevision')::numeric+CASE WHEN a IN('release','refund','dispute','resolve_dispute_release','resolve_dispute_refund') THEN 1 ELSE 0 END)::text,'actor',payment_v2.b58(k));
 p:=pg_temp.retained(p,'attestation',(d->>'commandId')::uuid,a,(f->>'network')::uuid);
 PERFORM public.fn_payment_v2_record_attestation(p);
END $$;
CREATE FUNCTION pg_temp.step(f jsonb,a text,p_staff uuid,seq integer,executed bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE d jsonb;
BEGIN d:=pg_temp.decide(f,a,p_staff);PERFORM pg_temp.attest_at(f,d,seq,coalesce(executed,extract(epoch FROM clock_timestamp())::bigint));RETURN d;END $$;
-- terminal(fixture, kind, n): the finalized terminal observation, recorded through the verifier RPC.
CREATE FUNCTION pg_temp.terminal(f jsonb,kind text,n integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p jsonb;
BEGIN
 p:=(f->'proof')||jsonb_build_object('kind',kind,'signature',payment_v2.b58(sha512(convert_to('m082-terminal-'||n,'UTF8'))),'slot',300+n,'decisionRevision','1');
 p:=pg_temp.retained(p,'payment_event',(f->>'attempt')::uuid,kind,(f->>'network')::uuid);
 RETURN public.fn_payment_v2_record_verified_event(p);
END $$;
CREATE FUNCTION pg_temp.enrol(f jsonb,p_enroller uuid,p_reviewer uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item uuid:=gen_random_uuid();card uuid:=gen_random_uuid();sku uuid;
BEGIN
 SELECT sku_id INTO sku FROM public.items WHERE id=(f->>'item')::uuid;
 INSERT INTO public.items(id,sku_id,consignor_id,status,float_value,custody,custody_holder_id) VALUES(item,sku,(f->>'seller')::uuid,'minted',0.1,'seller',(f->>'seller')::uuid);
 INSERT INTO public.cards(id,item_id,sku_id,owner_id,float_value,tier,mint_number) VALUES(card,item,sku,(f->>'seller')::uuid,0.1,1,(SELECT max(mint_number)+1 FROM public.cards WHERE sku_id=sku));
 INSERT INTO public.ledger_entries(txn_id,entry_type,asset,account_id,card_id,direction) VALUES(gen_random_uuid(),'mint','card',(f->>'seller')::uuid,card,1);
 INSERT INTO payment_v2.inventory(card_id,item_id,card_commitment,pair_commitment,custody_version,mode,enrollment_evidence,enrolled_by,approved_by)
 VALUES(card,item,sha256(uuid_send(card)),sha256(uuid_send(item)),1,0,sha256(uuid_send(item)),p_enroller,p_reviewer);
END $$;
CREATE FUNCTION pg_temp.mode() RETURNS text LANGUAGE sql AS $$
 SELECT operational_separation||','||governors_required||','||release_delay_seconds FROM payment_v2.governance_mode $$;
CREATE FUNCTION pg_temp.ok(label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'T083|PASS %',label;END $$;

-- Fixtures (each a funded seller-custody escrow) and the shared staff set.
DO $setup$
DECLARE n text;r jsonb;
BEGIN
 FOREACH n IN ARRAY ARRAY['A','B','C','D','E','R','S'] LOOP
  INSERT INTO fx VALUES(n,pg_temp.fixture(0::smallint));
  r:=public.fn_payment_v2_reconcile_event((pg_temp.f(n)->>'event')::uuid);
 END LOOP;
 INSERT INTO sx SELECT role,id FROM payment_v2.staff WHERE role<>'governor';
 INSERT INTO sx SELECT 'gov'||row_number() OVER (ORDER BY id),id FROM payment_v2.staff WHERE role='governor';
 PERFORM pg_temp.assert_true((SELECT count(*)=7 FROM fx)AND(SELECT count(*)=10 FROM sx),'fixtures and staff');
 PERFORM pg_temp.assert_true(pg_temp.mode()='separated,3,0','initial mode is separated,3,0');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM payment_v2.configuration_history WHERE entity='governance_mode'),'initial mode audited once');
 PERFORM pg_temp.ok('S0 initial mode separated,3,0, audited');
END $setup$;

-- S: separated mode keeps every pre-082 refusal.
DO $separated$
DECLARE uF uuid:=pg_temp.new_user();pF uuid:=gen_random_uuid();d jsonb;e uuid;
BEGIN
 PERFORM pg_temp.assert_true(payment_v2.funding_configuration((pg_temp.f('A')->>'network')::uuid),'fixture staff set is configured');
 -- A fourth active governor: configuration fails and a refund cannot be approved (THREE_GOVERNORS message kept).
 PERFORM pg_temp.staff('gov4',pg_temp.new_user(),gen_random_uuid(),'governor');
 PERFORM pg_temp.assert_true(NOT payment_v2.funding_configuration((pg_temp.f('A')->>'network')::uuid),'4 governors not configured');
 d:=pg_temp.decide(pg_temp.f('R'),'refund',pg_temp.s('gov1'));
 PERFORM pg_temp.act(pg_temp.s('gov2'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_approve_refund(%L)',d->>'commandId'),'PAYMENT_V2_THREE_GOVERNORS_REQUIRED');
 UPDATE payment_v2.staff SET active=false WHERE id=pg_temp.s('gov4');
 PERFORM public.fn_payment_v2_approve_refund((d->>'commandId')::uuid);
 PERFORM pg_temp.assert_true((SELECT ready FROM payment_v2.operations WHERE decision_id=(d->>'commandId')::uuid),'refund approved by 2 of 3');
 PERFORM pg_temp.assert_true(payment_v2.funding_configuration((pg_temp.f('A')->>'network')::uuid),'configured again');
 PERFORM pg_temp.ok('S1 governor set must be exactly 3 persons (THREE_GOVERNORS_REQUIRED); 2-of-3 refund approval');
 -- The founder: one person, one login, distinct keys per role. F2 shares F's authenticator key (same person: 063 binding).
 PERFORM pg_temp.staff('F_receiver',uF,pF,'receiver');PERFORM pg_temp.staff('F_authenticator',uF,pF,'authenticator');
 PERFORM pg_temp.staff('F_reviewer',uF,pF,'reviewer');PERFORM pg_temp.staff('F_release',uF,pF,'release');PERFORM pg_temp.staff('F_inventory',uF,pF,'inventory');
 PERFORM pg_temp.staff('F2_release',pg_temp.new_user(),pF,'release',(SELECT public_key FROM payment_v2.staff WHERE id=pg_temp.s('F_authenticator')));
 PERFORM pg_temp.staff('F3_reviewer',pg_temp.new_user(),pF,'reviewer',(SELECT public_key FROM payment_v2.staff WHERE id=pg_temp.s('F_inventory')));
 -- Same person, different keys: refused in separated mode at every step.
 PERFORM pg_temp.step(pg_temp.f('A'),'receipt',pg_temp.s('F_receiver'),1);
 d:=jsonb_build_object('escrowId',(SELECT id FROM payment_v2.escrows WHERE attempt_id=(pg_temp.f('A')->>'attempt')::uuid),'commandId',gen_random_uuid(),'expectedRevision','0','action','authentication_pass','evidenceDigest',repeat('ab',32),'pairCommitment',encode(sha256(uuid_send((pg_temp.f('A')->>'item')::uuid)),'hex'));
 PERFORM pg_temp.act(pg_temp.s('F_authenticator'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_decision(%L::jsonb)',d),'PAYMENT_V2_INDEPENDENT_PERSON_REQUIRED');
 PERFORM pg_temp.step(pg_temp.f('A'),'authentication_pass',pg_temp.s('authenticator'),2);
 PERFORM pg_temp.act(pg_temp.s('F_release'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_decision(%L::jsonb)',d||jsonb_build_object('commandId',gen_random_uuid(),'action','release')),'PAYMENT_V2_INDEPENDENT_PERSON_REQUIRED');
 PERFORM pg_temp.step(pg_temp.f('A'),'release',pg_temp.s('release'),3);
 e:=pg_temp.terminal(pg_temp.f('A'),'released',1);PERFORM public.fn_payment_v2_reconcile_event(e);
 PERFORM pg_temp.assert_true((SELECT state='released' FROM payment_v2.escrows WHERE attempt_id=(pg_temp.f('A')->>'attempt')::uuid),'A released');
 PERFORM pg_temp.assert_true((SELECT bool_and(mode_at_decision='separated') AND count(*)=3 FROM payment_v2.decisions dd JOIN payment_v2.escrows x ON x.id=dd.escrow_id WHERE x.attempt_id=(pg_temp.f('A')->>'attempt')::uuid),'A decisions stamped separated');
 PERFORM pg_temp.ok('S2 separated: same person with distinct keys refused (INDEPENDENT_PERSON_REQUIRED); independent release reconciles; stamped separated');
 -- B: released by independent persons in separated mode, delay 0; its terminal observation is reconciled after the switch to solo.
 PERFORM pg_temp.step(pg_temp.f('B'),'receipt',pg_temp.s('receiver'),4);
 PERFORM pg_temp.step(pg_temp.f('B'),'authentication_pass',pg_temp.s('authenticator'),5);
 PERFORM pg_temp.step(pg_temp.f('B'),'release',pg_temp.s('release'),6);
 PERFORM pg_temp.expect_error(format('SELECT pg_temp.enrol(%L::jsonb,%L,%L)',pg_temp.f('A'),pg_temp.s('F_inventory'),pg_temp.s('F_reviewer')),'PAYMENT_V2_CORRESPONDENCE');
 PERFORM pg_temp.ok('S3 separated: inventory enrolment by one person refused (CORRESPONDENCE)');
END $separated$;

-- G: governance RPCs.
DO $governance$
DECLARE p1 uuid;p2 uuid;p3 uuid;r jsonb;n integer;
  solo jsonb:='{"separation":"solo","governors":2,"delaySeconds":86400}';
BEGIN
 PERFORM pg_temp.act(pg_temp.s('F_receiver'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_propose_governance(''mode'',%L::jsonb)',solo),'PAYMENT_V2_GOVERNOR_REQUIRED');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_disable_funding()'),'PAYMENT_V2_GUARDIAN_OR_GOVERNOR_REQUIRED');
 PERFORM pg_temp.act(pg_temp.s('gov4'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_propose_governance(''mode'',%L::jsonb)',solo),'PAYMENT_V2_GOVERNOR_REQUIRED');
 PERFORM pg_temp.act(pg_temp.s('gov1'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_propose_governance(''mode'',%L::jsonb)',solo),'PAYMENT_V2_FUNDING_ENABLED');
 PERFORM pg_temp.ok('G1 only an active governor proposes; no mode change while funding is enabled');
 PERFORM pg_temp.act(pg_temp.s('guardian'));
 n:=public.fn_payment_v2_disable_funding();
 PERFORM pg_temp.assert_true(n=7 AND NOT EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled),'guardian disabled funding on all 7 networks');
 PERFORM pg_temp.assert_true(public.fn_payment_v2_disable_funding()=0,'disable is idempotent');
 PERFORM pg_temp.ok('G2 a single guardian disables funding everywhere');
 PERFORM pg_temp.act(pg_temp.s('gov1'));
 PERFORM pg_temp.expect_error($q$SELECT public.fn_payment_v2_propose_governance('mode','{"separation":"solo","governors":3,"delaySeconds":86400}')$q$,'PAYMENT_V2_GOVERNANCE_MODE_INVALID');
 PERFORM pg_temp.expect_error($q$SELECT public.fn_payment_v2_propose_governance('mode','{"separation":"solo","governors":2,"delaySeconds":3600}')$q$,'PAYMENT_V2_GOVERNANCE_MODE_INVALID');
 PERFORM pg_temp.expect_error($q$SELECT public.fn_payment_v2_propose_governance('mode','{"separation":"solo","governors":2,"delaySeconds":86400,"x":1}')$q$,'PAYMENT_V2_GOVERNANCE_MODE_INVALID');
 PERFORM pg_temp.expect_error($q$SELECT public.fn_payment_v2_propose_governance('mode','{"separation":"duo","governors":2,"delaySeconds":86400}')$q$,'PAYMENT_V2_GOVERNANCE_MODE_INVALID');
 PERFORM pg_temp.expect_error($q$SELECT public.fn_payment_v2_propose_governance('mode','{"separation":"solo","governors":"2","delaySeconds":86400}')$q$,'PAYMENT_V2_GOVERNANCE_MODE_INVALID');
 PERFORM pg_temp.expect_error($q$SELECT public.fn_payment_v2_propose_governance('pause','{}')$q$,'PAYMENT_V2_GOVERNANCE_KIND');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_propose_governance(''enable_funding'',%L::jsonb)',jsonb_build_object('networkId',gen_random_uuid())),'PAYMENT_V2_GOVERNANCE_NETWORK');
 PERFORM pg_temp.ok('G3 invalid mode / kind / network payloads refused');
 -- Enabling funding needs funding_configuration (the founder rows make it false now).
 p3:=public.fn_payment_v2_propose_governance('enable_funding',jsonb_build_object('networkId',pg_temp.f('A')->>'network'));
 PERFORM pg_temp.act(pg_temp.s('gov2'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_approve_governance(%L)',p3),'PAYMENT_V2_NOT_CONFIGURED');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled),'still disabled');
 PERFORM pg_temp.ok('G4 enable_funding refused while funding_configuration is false (NOT_CONFIGURED)');
 -- Mode switch: proposer is approval 1; same person refused; a second governor person applies it once.
 PERFORM pg_temp.act(pg_temp.s('gov1'));
 p1:=public.fn_payment_v2_propose_governance('mode',solo);
 p2:=public.fn_payment_v2_propose_governance('mode','{"separation":"solo","governors":2,"delaySeconds":90000}');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_approve_governance(%L)',p1),'PAYMENT_V2_GOVERNANCE_SAME_PERSON');
 PERFORM pg_temp.assert_true(pg_temp.mode()='separated,3,0','one approval changes nothing');
 PERFORM pg_temp.act(pg_temp.s('gov2'));
 r:=public.fn_payment_v2_approve_governance(p1);
 PERFORM pg_temp.assert_true((r->>'applied')::boolean AND (r->>'approvals')::int=2,'applied at 2 approvals');
 PERFORM pg_temp.assert_true(pg_temp.mode()='solo,2,86400','mode is solo,2,86400');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM payment_v2.configuration_history WHERE entity='governance_mode'),'switch audited');
 PERFORM pg_temp.assert_true((SELECT after_value->>'operational_separation'='solo' AND before_value->>'operational_separation'='separated' FROM payment_v2.configuration_history WHERE entity='governance_mode' AND before_value IS NOT NULL),'audit before/after');
 PERFORM pg_temp.act(pg_temp.s('gov3'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_approve_governance(%L)',p1),'PAYMENT_V2_GOVERNANCE_ALREADY_APPLIED');
 PERFORM pg_temp.act(pg_temp.s('gov2'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_approve_governance(%L)',p2),'PAYMENT_V2_GOVERNANCE_STALE');
 PERFORM pg_temp.assert_true(pg_temp.mode()='solo,2,86400','stale proposal changed nothing');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_approve_governance(%L)',gen_random_uuid()),'PAYMENT_V2_GOVERNANCE_PROPOSAL_MISSING');
 PERFORM pg_temp.ok('G5 2-of-N distinct governor persons; same person, re-apply, stale base and missing proposal refused; audited');
 PERFORM pg_temp.expect_error(format('UPDATE payment_v2.governance_proposals SET payload=''{}'' WHERE id=%L',p1),'PAYMENT_V2_IMMUTABLE');
 PERFORM pg_temp.expect_error(format('DELETE FROM payment_v2.governance_proposal_approvals WHERE proposal_id=%L',p1),'PAYMENT_V2_IMMUTABLE');
 PERFORM pg_temp.expect_error(format('DELETE FROM payment_v2.governance_proposal_applied WHERE proposal_id=%L',p1),'PAYMENT_V2_IMMUTABLE');
 PERFORM pg_temp.expect_error('DELETE FROM payment_v2.governance_mode','PAYMENT_V2_IMMUTABLE');
 PERFORM pg_temp.expect_error('UPDATE payment_v2.governance_mode SET governors_required=3','violates check constraint');
 PERFORM pg_temp.expect_error('UPDATE payment_v2.governance_mode SET release_delay_seconds=3600','violates check constraint');
 PERFORM pg_temp.expect_error('INSERT INTO payment_v2.governance_mode(operational_separation,governors_required,release_delay_seconds) VALUES(''separated'',3,0)','duplicate key');
 PERFORM pg_temp.ok('G6 records immutable; mode row singleton; solo requires 2 governors and >=86400 s');
END $governance$;

-- O: solo mode.
DO $solo$
DECLARE d jsonb;e uuid;t0 bigint:=extract(epoch FROM clock_timestamp())::bigint-90000;x uuid;
BEGIN
 -- B was released under separated (delay 0, judged by its stamp); reconciling now, in solo, must not strand it.
 e:=pg_temp.terminal(pg_temp.f('B'),'released',2);PERFORM public.fn_payment_v2_reconcile_event(e);
 PERFORM pg_temp.assert_true((SELECT state='released' FROM payment_v2.escrows WHERE attempt_id=(pg_temp.f('B')->>'attempt')::uuid),'B released after the switch');
 PERFORM pg_temp.ok('O1 an in-flight separated release reconciles after the switch to solo (judged by its stamped mode)');
 -- C: one person, distinct keys: receipt and authentication accepted; same key refused; immediate release refused (delay).
 PERFORM pg_temp.step(pg_temp.f('C'),'receipt',pg_temp.s('F_receiver'),20);
 PERFORM pg_temp.step(pg_temp.f('C'),'authentication_pass',pg_temp.s('F_authenticator'),21);
 x:=(SELECT id FROM payment_v2.escrows WHERE attempt_id=(pg_temp.f('C')->>'attempt')::uuid);
 d:=jsonb_build_object('escrowId',x,'commandId',gen_random_uuid(),'expectedRevision','0','action','release','evidenceDigest',repeat('ab',32),'pairCommitment',encode(sha256(uuid_send((pg_temp.f('C')->>'item')::uuid)),'hex'));
 PERFORM pg_temp.act(pg_temp.s('F2_release'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_decision(%L::jsonb)',d),'PAYMENT_V2_INDEPENDENT_KEY_REQUIRED');
 PERFORM pg_temp.act(pg_temp.s('F_release'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_decision(%L::jsonb)',d),'PAYMENT_V2_RELEASE_DELAY');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 AND bool_and(mode_at_decision='solo') FROM payment_v2.decisions WHERE escrow_id=x),'C: only receipt+authentication, stamped solo');
 PERFORM pg_temp.ok('O2 solo: one person with distinct keys accepted; same key refused (INDEPENDENT_KEY_REQUIRED); release inside 24 h refused (RELEASE_DELAY)');
 -- D: authentication executed 25 h ago: release accepted and reconciled.
 PERFORM pg_temp.step(pg_temp.f('D'),'receipt',pg_temp.s('F_receiver'),30,t0-60);
 PERFORM pg_temp.step(pg_temp.f('D'),'authentication_pass',pg_temp.s('F_authenticator'),31,t0);
 PERFORM pg_temp.step(pg_temp.f('D'),'release',pg_temp.s('F_release'),32);
 e:=pg_temp.terminal(pg_temp.f('D'),'released',3);PERFORM public.fn_payment_v2_reconcile_event(e);
 PERFORM pg_temp.assert_true((SELECT state='released' FROM payment_v2.escrows WHERE attempt_id=(pg_temp.f('D')->>'attempt')::uuid),'D released');
 PERFORM pg_temp.assert_true((SELECT status='active' FROM public.cards WHERE id=(pg_temp.f('D')->>'card')::uuid),'D card active');
 PERFORM pg_temp.assert_true((SELECT count(*)=3 AND bool_and(mode_at_decision='solo') FROM payment_v2.decisions dd JOIN payment_v2.escrows xx ON xx.id=dd.escrow_id WHERE xx.attempt_id=(pg_temp.f('D')->>'attempt')::uuid),'D stamped solo');
 PERFORM pg_temp.ok('O3 solo: release 25 h after authentication accepted and reconciled; stamped solo');
 -- E: the release decision passes, but its on-chain execution is only 100 s after authentication: reconcile refuses.
 PERFORM pg_temp.step(pg_temp.f('E'),'receipt',pg_temp.s('F_receiver'),40,t0-60);
 PERFORM pg_temp.step(pg_temp.f('E'),'authentication_pass',pg_temp.s('F_authenticator'),41,t0);
 d:=pg_temp.decide(pg_temp.f('E'),'release',pg_temp.s('F_release'));PERFORM pg_temp.attest_at(pg_temp.f('E'),d,42,t0+100);
 e:=pg_temp.terminal(pg_temp.f('E'),'released',4);
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_reconcile_event(%L)',e),'PAYMENT_V2_RELEASE_DELAY');
 PERFORM pg_temp.assert_true((SELECT state='funded' FROM payment_v2.escrows WHERE attempt_id=(pg_temp.f('E')->>'attempt')::uuid),'E not released');
 PERFORM pg_temp.ok('O4 solo: reconcile refuses a release executed inside 24 h of authentication (RELEASE_DELAY)');
 -- Inventory enrolment: one person with distinct keys accepted; same key refused.
 PERFORM pg_temp.enrol(pg_temp.f('A'),pg_temp.s('F_inventory'),pg_temp.s('F_reviewer'));
 PERFORM pg_temp.expect_error(format('SELECT pg_temp.enrol(%L::jsonb,%L,%L)',pg_temp.f('A'),pg_temp.s('F_inventory'),pg_temp.s('F3_reviewer')),'PAYMENT_V2_CORRESPONDENCE');
 PERFORM pg_temp.ok('O5 solo: enrolment with distinct keys accepted, same key refused (CORRESPONDENCE)');
 -- Refund: the governor set must be exactly 2 persons in solo.
 d:=pg_temp.decide(pg_temp.f('S'),'refund',pg_temp.s('gov1'));
 PERFORM pg_temp.act(pg_temp.s('gov2'));
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_approve_refund(%L)',d->>'commandId'),'PAYMENT_V2_GOVERNOR_SET_INCOMPLETE');
 UPDATE payment_v2.staff SET active=false WHERE id=pg_temp.s('gov3');
 PERFORM public.fn_payment_v2_approve_refund((d->>'commandId')::uuid);
 PERFORM pg_temp.assert_true((SELECT ready FROM payment_v2.operations WHERE decision_id=(d->>'commandId')::uuid),'solo refund approved by both governors');
 PERFORM pg_temp.assert_true((SELECT mode_at_decision='solo' FROM payment_v2.decisions WHERE id=(d->>'commandId')::uuid),'refund stamped solo');
 PERFORM pg_temp.ok('O6 solo: refund needs exactly 2 governor persons (GOVERNOR_SET_INCOMPLETE with 3); 2-of-2 approval');
END $solo$;

-- R: a solo configuration enables funding; mode changes need funding off; switching back restores the 4-person rule.
DO $roundtrip$
DECLARE p uuid;r jsonb;net uuid:=(pg_temp.f('A')->>'network')::uuid;
BEGIN
 UPDATE payment_v2.staff SET active=false WHERE id IN(pg_temp.s('receiver'),pg_temp.s('authenticator'),pg_temp.s('reviewer'),pg_temp.s('release'),pg_temp.s('F_inventory'),pg_temp.s('F2_release'),pg_temp.s('F3_reviewer'));
 PERFORM pg_temp.assert_true(payment_v2.funding_configuration(net),'solo configuration: 1 operational person, 2 governors, 9 keys');
 PERFORM pg_temp.act(pg_temp.s('gov1'));
 p:=public.fn_payment_v2_propose_governance('enable_funding',jsonb_build_object('networkId',net));
 PERFORM pg_temp.act(pg_temp.s('gov2'));
 r:=public.fn_payment_v2_approve_governance(p);
 PERFORM pg_temp.assert_true((r->>'applied')::boolean AND (SELECT funding_enabled FROM payment_v2.networks WHERE id=net),'funding enabled by 2 governors');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM payment_v2.networks WHERE funding_enabled),'only that network');
 PERFORM pg_temp.expect_error($q$SELECT public.fn_payment_v2_propose_governance('mode','{"separation":"separated","governors":3,"delaySeconds":0}')$q$,'PAYMENT_V2_FUNDING_ENABLED');
 PERFORM pg_temp.assert_true(public.fn_payment_v2_disable_funding()=1,'a governor alone disables funding');
 PERFORM pg_temp.ok('R1 solo configuration enables funding (2 governors); mode frozen while funded; one governor disables');
 p:=public.fn_payment_v2_propose_governance('mode','{"separation":"separated","governors":3,"delaySeconds":0}');
 PERFORM pg_temp.act(pg_temp.s('gov1'));
 r:=public.fn_payment_v2_approve_governance(p);
 PERFORM pg_temp.assert_true((r->>'applied')::boolean AND pg_temp.mode()='separated,3,0','back to separated');
 PERFORM pg_temp.assert_true(NOT payment_v2.funding_configuration(net),'separated: one operational person and 2 governors is not configured');
 PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM payment_v2.configuration_history WHERE entity='governance_mode'),'three audited states');
 PERFORM pg_temp.ok('R2 switch back to separated restores the 3-governor and 4-person rules');
END $roundtrip$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'T083|SUITE_PASS';
