-- DRAFT / NOT RUN. Synthetic-only committed test setup. Use a fresh disposable target.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
\ir 02_attestation_fixture.sql
CREATE SCHEMA payment_db_races;
CREATE TABLE payment_db_races.cases(name text PRIMARY KEY,f jsonb NOT NULL);
CREATE TABLE payment_db_races.observations(name text,side text,payload jsonb NOT NULL,login name NOT NULL DEFAULT session_user,backend_pid integer NOT NULL DEFAULT pg_backend_pid(),PRIMARY KEY(name,side));
CREATE FUNCTION payment_db_races.assert_true(p boolean,label text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',label;END IF;END $$;
CREATE FUNCTION payment_db_races.expect_error(statement text,fragment text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN IF strpos(SQLERRM,fragment)=0 THEN RAISE;END IF;RETURN jsonb_build_object('rejected',fragment);END;RAISE EXCEPTION 'expected rejection: %',statement;END $$;
INSERT INTO payment_db_races.cases VALUES
 ('conflicting_signature',pg_temp.fixture(0::smallint,3600)),('conflicting_attempt',pg_temp.fixture(0::smallint,3600)),
 ('funding_cancel',pg_temp.fixture(0::smallint,3600)),('funding_revoke',pg_temp.fixture(0::smallint,3600)),
 ('revoked_funding',pg_temp.fixture(0::smallint,3600,false)),('rollback',pg_temp.fixture(0::smallint,3600)),
 ('release_refund',pg_temp.fixture(0::smallint,3600)),('refund_release',pg_temp.fixture(0::smallint,3600));
DO $prepare$ DECLARE c record;d jsonb;p jsonb;cmd jsonb;buyer uuid;status jsonb;BEGIN
 FOR c IN SELECT name,f FROM payment_db_races.cases LOOP
  IF c.name='conflicting_attempt' THEN
   buyer:=gen_random_uuid();INSERT INTO public.users(id,auth_id,handle,email,country_code,solana_address) VALUES(buyer,buyer,'r-'||left(replace(buyer::text,'-',''),22),buyer||'@example.invalid','MY',payment_v2.b58(sha256(uuid_send(buyer))));
   INSERT INTO payment_v2.wallet_accounts VALUES(buyer,(c.f->>'network')::uuid,sha256(uuid_send(buyer)),sha256(uuid_send(buyer)||decode('01','hex')),sha256(uuid_send(buyer)));
   PERFORM set_config('request.jwt.claim.sub',buyer::text,true);
   status:=public.fn_payment_v2_initiate((c.f->>'listing')::uuid,gen_random_uuid(),'MY-USDC-ESCROW-1','834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5');
   p:=(c.f->'proof')||jsonb_build_object('attempt',payment_v2.b58(sha256(uuid_send((status->>'id')::uuid))),'permitHex',public.fn_payment_v2_authorize_attempt((status->>'id')::uuid),'signature',repeat('C',88));
   UPDATE payment_db_races.cases SET f=f||jsonb_build_object('conflict',p) WHERE name=c.name;
  ELSIF c.name='revoked_funding' THEN
   p:=(c.f->'proof')||jsonb_build_object('permitHex',public.fn_payment_v2_authorize_attempt((c.f->>'attempt')::uuid));
   UPDATE payment_db_races.cases SET f=f||jsonb_build_object('proof',p) WHERE name=c.name;
  ELSIF c.name IN('release_refund','refund_release') THEN
   PERFORM public.fn_payment_v2_reconcile_event((c.f->>'event')::uuid);
   IF c.name='release_refund' THEN PERFORM pg_temp.attest(c.f,'receipt',1);PERFORM pg_temp.attest(c.f,'authentication_pass',2);cmd:=pg_temp.attest(c.f,'release',3);
   ELSE cmd:=pg_temp.attest(c.f,'refund',4);END IF;
   p:=(c.f->'proof')||jsonb_build_object('kind',CASE c.name WHEN 'release_refund' THEN 'released' ELSE 'refunded' END,'signature',repeat('4',87)||'D','slot',60,'decisionRevision','1');
   -- Only this one terminal observation is the canonical fixture outcome. Its opposite is adversarial, NOT a second chain result.
   p:=pg_temp.retained(p,'payment_event',(c.f->>'attempt')::uuid,p->>'kind',(c.f->>'network')::uuid); -- 068 retained evidence
   UPDATE payment_db_races.cases SET f=f||jsonb_build_object('terminal',p) WHERE name=c.name;
  END IF;
  d:=jsonb_build_object('saleId',c.f->>'sale','kind','revoked','finality','finalized','sale',c.f->'proof'->>'sale','genesis',c.f->'proof'->>'genesis','program',c.f->'proof'->>'program','generation','1','revision','1','signature',repeat('4',87)||'E','slot',70);
  d:=pg_temp.retained(d,'lifecycle',(c.f->>'sale')::uuid,'revoked',(c.f->>'network')::uuid); -- 068 retained evidence
  UPDATE payment_db_races.cases SET f=f||jsonb_build_object('revocation',d) WHERE name=c.name;
 END LOOP;
END $prepare$;
-- Remove other synthetic queue work from eligibility, then create exactly two worker items/jobs.
UPDATE payment_v2.operations SET ready=false WHERE state<>'observed';
UPDATE payment_v2.outbox SET available_at=clock_timestamp()+interval '1 day';
DO $queues$ DECLARE f jsonb;s uuid;e uuid;q1 uuid;q2 uuid;ord uuid;rev numeric;payload jsonb;BEGIN
 f:=pg_temp.fixture(1::smallint,3600);PERFORM public.fn_payment_v2_reconcile_event((f->>'event')::uuid);
 s:=(f->>'sale')::uuid;e:=(f->>'event')::uuid;
 SELECT id INTO ord FROM public.orders WHERE payment_v2_attempt_id=(f->>'attempt')::uuid;
 SELECT decision_revision INTO rev FROM payment_v2.events WHERE id=e;
 payload:=jsonb_build_object('saleId',s,'eventId',e,'orderId',ord);
 -- The fixture's own acknowledgement is real; disable it so the two race rows below are the only lease candidates.
 UPDATE payment_v2.operations SET ready=false WHERE sale_id=s AND action='acknowledge_claim';
 q1:=payment_v2.enqueue(s,'acknowledge_claim',payload,rev);
 q2:=payment_v2.enqueue(s,'acknowledge_claim',payload,rev);
 f:=f||jsonb_build_object('operationIds',jsonb_build_array(q1,q2),'outboxIds',(SELECT jsonb_agg(id) FROM payment_v2.outbox WHERE event_id=e));
 INSERT INTO payment_db_races.cases VALUES('operations',f),('outbox',f),('operation_takeover',f),('outbox_takeover',f);
END $queues$;
CREATE FUNCTION payment_db_races.run_a(p_case text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE f jsonb;e uuid;r jsonb;BEGIN
 SELECT c.f INTO f FROM payment_db_races.cases c WHERE name=p_case;
 CASE p_case
 WHEN 'conflicting_signature','conflicting_attempt','funding_revoke','rollback' THEN RETURN public.fn_payment_v2_reconcile_event((f->>'event')::uuid);
 WHEN 'release_refund','refund_release' THEN e:=public.fn_payment_v2_record_verified_event(f->'terminal');RETURN jsonb_build_object('event',e);
 WHEN 'funding_cancel' THEN PERFORM set_config('request.jwt.claim.sub',f->>'seller',true);PERFORM public.fn_payment_v2_request_cancel((f->>'listing')::uuid,(f->>'seller')::uuid);RETURN jsonb_build_object('cancel','requested');
 WHEN 'revoked_funding' THEN PERFORM public.fn_payment_v2_record_lifecycle(f->'revocation');RETURN jsonb_build_object('revoked',true);
 WHEN 'operations','operation_takeover' THEN r:=public.fn_payment_v2_claim_operations('00000000-0000-0000-0000-000000000201',1);RETURN r;
 WHEN 'outbox','outbox_takeover' THEN r:=public.fn_payment_v2_claim_outbox(1);RETURN r;
 ELSE RAISE EXCEPTION 'unknown case';END CASE;
END $$;
CREATE FUNCTION payment_db_races.run_b(p_case text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE f jsonb;r jsonb;e uuid;BEGIN
 SELECT c.f INTO f FROM payment_db_races.cases c WHERE name=p_case;
 CASE p_case
 WHEN 'conflicting_signature' THEN RETURN payment_db_races.expect_error(format('SELECT public.fn_payment_v2_record_verified_event(%L::jsonb)',(f->'proof')||jsonb_build_object('signature',repeat('F',88))),'CONFLICTING_EVIDENCE');
 WHEN 'conflicting_attempt' THEN RETURN payment_db_races.expect_error(format('SELECT public.fn_payment_v2_record_verified_event(%L::jsonb)',f->'conflict'),'CONFLICTING_EVIDENCE');
 WHEN 'release_refund','refund_release' THEN
  r:=payment_db_races.expect_error(format('SELECT public.fn_payment_v2_record_verified_event(%L::jsonb)',(f->'terminal')||jsonb_build_object('kind',CASE p_case WHEN 'release_refund' THEN 'refunded' ELSE 'released' END,'signature',repeat('G',88))),'CONFLICTING_EVIDENCE');
  e:=public.fn_payment_v2_record_verified_event(f->'terminal');RETURN r||jsonb_build_object('event',e); -- consumption uses a SEPARATE dedicated settler connection in56
 WHEN 'funding_cancel','rollback' THEN RETURN public.fn_payment_v2_reconcile_event((f->>'event')::uuid);
 WHEN 'funding_revoke' THEN RETURN payment_db_races.expect_error(format('SELECT public.fn_payment_v2_record_lifecycle(%L::jsonb)',f->'revocation'),'CONSUMED_SALE_CANNOT_REVOKE');
 WHEN 'revoked_funding' THEN RETURN payment_db_races.expect_error(format('SELECT public.fn_payment_v2_record_verified_event(%L::jsonb)',f->'proof'),'FUNDING_CONTRADICTS_SALE_STATE');
 WHEN 'operations','operation_takeover' THEN RETURN public.fn_payment_v2_claim_operations('00000000-0000-0000-0000-000000000202',1);
 WHEN 'outbox','outbox_takeover' THEN RETURN public.fn_payment_v2_claim_outbox(1);
 ELSE RAISE EXCEPTION 'unknown case';END CASE;
END $$;
DO $roles$ DECLARE r text;v text;login name;BEGIN
 FOREACH r IN ARRAY ARRAY['executor','notifier'] LOOP FOREACH v IN ARRAY ARRAY['a','b'] LOOP
  login:=('payment_db_race_'||r||'_'||v)::name;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=login) THEN RAISE EXCEPTION 'existing synthetic principal: do not repurpose';END IF;
  EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',login);
  EXECUTE format('GRANT %I TO %I','payment_v2_'||r,login);
 END LOOP;END LOOP;
 GRANT USAGE ON SCHEMA payment_db_races TO payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
 GRANT SELECT ON payment_db_races.cases,payment_db_races.observations TO payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
 GRANT INSERT ON payment_db_races.observations TO payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier;
END $roles$;
COMMIT;
