-- DRAFT INTEGRATION TESTS / NOT RUN. psql only, never npm/test discovery.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
SELECT pg_temp.expect_error('SELECT 1.5::payment_v2.u64','violates check constraint');
CREATE TEMP TABLE cases(mode smallint PRIMARY KEY,fixture jsonb NOT NULL);
INSERT INTO cases VALUES(0,pg_temp.fixture(0::smallint)),(1,pg_temp.fixture(1::smallint));
-- Preserve a synthetic historical direct order. Nothing is inferred from a sol: prefix.
CREATE TEMP TABLE historical AS SELECT id,settlement_ref,paid_out,stripe_transfer_id,gross_cents,fee_cents,net_cents,payment_rail FROM public.orders;
DO $tests$
DECLARE c record;r jsonb;r2 jsonb;o uuid;f jsonb;s uuid;x uuid;cmd jsonb;op uuid;st payment_v2.staff%rowtype;proof jsonb;terminal uuid;
BEGIN
 FOR c IN SELECT mode,fixture FROM cases LOOP
  f:=c.fixture;
  PERFORM pg_temp.assert_true(octet_length(decode(f->>'permit','hex'))=690 AND substring(decode(f->>'permit','hex') FROM 1 FOR 9)=decode('46534f415256320002','hex'),'canonical header/version/length');
  PERFORM pg_temp.assert_true(get_byte(decode(f->>'permit','hex'),9)=c.mode AND substring(decode(f->>'permit','hex') FROM 651 FOR 8)=decode('404b4c0000000000','hex'),'canonical mode and total u64 offset650');
  r:=public.fn_payment_v2_reconcile_event((f->>'event')::uuid);r2:=public.fn_payment_v2_reconcile_event((f->>'event')::uuid);
  PERFORM pg_temp.assert_true(r=r2,'exact reconciliation retry returns original order');o:=(r->>'orderId')::uuid;
  PERFORM pg_temp.assert_true((SELECT count(1)=1 FROM public.orders WHERE payment_v2_attempt_id=(f->>'attempt')::uuid),'one order');
  PERFORM pg_temp.assert_true((SELECT sum(units)=0 FROM payment_v2.usdc_journal WHERE event_id=(f->>'event')::uuid),'USDC balances');
  PERFORM pg_temp.assert_true((SELECT gross_cents=2000 AND cash_cents=0 AND credit_cents=0 AND seller_payout IS NULL AND NOT paid_out AND stripe_transfer_id IS NULL FROM public.orders WHERE id=o),'MYR valuation is not USDC or Stripe payout');
  PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_verified_event(%L::jsonb)',(f->'proof')||jsonb_build_object('signature',repeat('4',88))),'CONFLICTING_EVIDENCE');
  PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_verified_event(%L::jsonb)',(f->'proof')||jsonb_build_object('permitHex',repeat('00',690))),'EVIDENCE_CORRESPONDENCE');
  PERFORM pg_temp.expect_error(format('DELETE FROM payment_v2.attempts WHERE id=%L',f->>'attempt'),'IMMUTABLE');
  PERFORM pg_temp.expect_error(format('UPDATE payment_v2.attempts SET buyer_wallet=decode(repeat(''ff'',32),''hex'') WHERE id=%L',f->>'attempt'),'TERMS_IMMUTABLE');
  -- postgres legacy DEFINER helpers must be fenced too, not only ordinary table clients.
  PERFORM pg_temp.expect_error(format('UPDATE public.cards SET status=''active'' WHERE id=%L',f->>'card'),'LEGACY_MUTATION_FENCED');
  PERFORM pg_temp.expect_error(format('UPDATE public.items SET authenticated_at=now() WHERE id=%L',f->>'item'),'LEGACY_MUTATION_FENCED');
  PERFORM pg_temp.expect_error(format('INSERT INTO public.redemptions(card_id,item_id,user_id,handling_fee_cents,shipping_address) VALUES(%L,%L,%L,0,''{}'')',f->>'card',f->>'item',f->>'buyer'),'LEGACY_MUTATION_FENCED');
  PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_request_cancel(%L,%L)',f->>'listing',f->>'buyer'),'NOT_OWNER');
  IF c.mode=0 THEN
   PERFORM set_config('request.jwt.claim.sub',f->>'buyer',true);
   PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_list_card(%L,%L,2000,''cash'',NULL)',f->>'card',f->>'buyer'),'LISTING_UNAVAILABLE');
   PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_redeem_card(%L,%L,''{}'',0)',f->>'card',f->>'buyer'),'REDEMPTION_UNAVAILABLE');
   SELECT id INTO x FROM payment_v2.escrows WHERE attempt_id=(f->>'attempt')::uuid;
   PERFORM pg_temp.assert_true((SELECT status='pending_vault' AND owner_id=(f->>'buyer')::uuid FROM public.cards WHERE id=(f->>'card')::uuid),'conditional ownership');
   SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE role='receiver';PERFORM set_config('request.jwt.claim.sub',st.user_id::text,true);
   cmd:=jsonb_build_object('escrowId',x,'commandId',gen_random_uuid(),'expectedRevision','0','action','receipt','evidenceDigest',repeat('ab',32),'pairCommitment',encode(sha256(uuid_send((f->>'item')::uuid)),'hex'));
   op:=public.fn_payment_v2_record_decision(cmd);
   proof:=jsonb_build_object('commandId',cmd->>'commandId','finality','finalized','sale',f->'proof'->>'sale','genesis',f->'proof'->>'genesis','program',f->'proof'->>'program','action','receipt','evidenceDigest',cmd->>'evidenceDigest','pairCommitment',cmd->>'pairCommitment','signature',repeat('5',88),'slot',3,'executedAtSeconds',extract(epoch FROM now())::bigint,'resultingRevision','0','actor',payment_v2.b58(st.public_key));
   PERFORM public.fn_payment_v2_record_attestation(proof);PERFORM public.fn_payment_v2_record_attestation(proof);
   PERFORM pg_temp.assert_true((SELECT authentication='pending' FROM payment_v2.escrows WHERE id=x),'receipt is not authentication');
   PERFORM pg_temp.assert_true((SELECT status='pending_vault' FROM public.cards WHERE id=(f->>'card')::uuid),'receipt cannot unlock');
   SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE role='authenticator';PERFORM set_config('request.jwt.claim.sub',st.user_id::text,true);
   cmd:=cmd||jsonb_build_object('commandId',gen_random_uuid(),'action','authentication_fail');op:=public.fn_payment_v2_record_decision(cmd);
   proof:=proof||jsonb_build_object('commandId',cmd->>'commandId','action','authentication_fail','signature',repeat('6',88),'slot',4,'actor',payment_v2.b58(st.public_key));PERFORM public.fn_payment_v2_record_attestation(proof);
   SELECT id,user_id,person_id,role,public_key,active INTO st.id,st.user_id,st.person_id,st.role,st.public_key,st.active FROM payment_v2.staff WHERE role='release';PERFORM set_config('request.jwt.claim.sub',st.user_id::text,true);
   cmd:=cmd||jsonb_build_object('commandId',gen_random_uuid(),'action','release');
   PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_decision(%L::jsonb)',cmd),'AUTHENTICATION_REQUIRED');
   PERFORM pg_temp.assert_true((SELECT status='pending_vault' FROM public.cards WHERE id=(f->>'card')::uuid),'failed authentication cannot unlock');
  END IF;
 END LOOP;
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT id,settlement_ref,paid_out,stripe_transfer_id,gross_cents,fee_cents,net_cents,payment_rail FROM historical EXCEPT SELECT id,settlement_ref,paid_out,stripe_transfer_id,gross_cents,fee_cents,net_cents,payment_rail FROM public.orders),'legacy records unchanged');
 FOR c IN SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS identity_args,p.proargtypes FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('fn_purchase_card','fn_purchase_card_core','fn_purchase_card_with_credit','fn_redeem_card','fn_vault_receive','fn_vault_mark_defaulted','fn_confirm_sale_cancellation','fn_accept_trade_offer') LOOP
  PERFORM pg_temp.expect_error(format('SELECT public.%I(%s)',c.proname,(SELECT string_agg('NULL::'||format_type(args.type_oid,NULL),',') FROM unnest(c.proargtypes::oid[]) args(type_oid))),'LEGACY_PATH_RETIRED');
 END LOOP;
END $tests$;
-- Force deferred USDC/card journal constraints now, within this rollback-only fixture transaction.
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
