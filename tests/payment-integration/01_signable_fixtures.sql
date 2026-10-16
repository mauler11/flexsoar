-- Integration ONLY. Host must first attest exact preserved container/network namespace.
-- No accepted payment-db fixture or target guard is changed by this script.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'flexsoar_payment_v2_integration_test' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR session_user<>'supabase_admin' THEN RAISE EXCEPTION 'integration fixture target mismatch'; END IF;
 -- An unsuccessful pre-sale setup may be superseded without deleting its history.
 -- This is synthetic configuration rotation, NEVER recovery of a funded purchase.
 IF EXISTS(SELECT 1 FROM payment_v2.sales) OR EXISTS(SELECT 1 FROM payment_v2.attempts) OR EXISTS(SELECT 1 FROM public.orders)
 OR EXISTS(SELECT 1 FROM public.cards) OR EXISTS(SELECT 1 FROM payment_v2.operations)
 THEN RAISE EXCEPTION 'cannot supersede configuration with any sale or obligation';END IF;
END $$;
UPDATE payment_v2.staff SET active=false WHERE active;
UPDATE payment_v2.networks SET funding_enabled=false WHERE funding_enabled;
-- Exact approved policy and required historical reference seeds are applied
-- from reviewed checked-in INSERTs BEFORE this fixture. No accepted data copied.
CREATE TEMP TABLE fixture_input(value jsonb);
INSERT INTO fixture_input VALUES(:'fixture'::jsonb);
DO $$DECLARE f jsonb; r record;u uuid;BEGIN
 SELECT value INTO f FROM fixture_input;
 FOR r IN SELECT key,value FROM jsonb_each(f->'people') LOOP
  u:=(r.value->>'id')::uuid;
  INSERT INTO public.users(id,auth_id,handle,email,country_code,solana_address)
  VALUES(u,u,'i-'||left(replace(u::text,'-',''),22),u||'@integration.invalid','MY',r.value->>'wallet');
  IF r.value ? 'role' THEN
   INSERT INTO payment_v2.staff(id,user_id,person_id,role,public_key)
   VALUES(u,u,u,r.value->>'role',payment_v2.unb58(r.value->>'wallet'));
  END IF;
 END LOOP;
 INSERT INTO payment_v2.networks(id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units)
 VALUES((f->>'networkId')::uuid,payment_v2.unb58(f->>'genesis'),payment_v2.unb58(f->>'program'),payment_v2.unb58(f->>'config'),payment_v2.unb58(f->>'mint'),payment_v2.unb58(f->>'tokenProgram'),payment_v2.unb58(f->>'treasury'),payment_v2.unb58(f->>'treasuryToken'),payment_v2.unb58(f->>'issuer'),2,'MY-USDC-ESCROW-1',true,2000000,10000000);
 FOR r IN SELECT key,value FROM jsonb_each(f->'people') WHERE value ? 'token' LOOP
  INSERT INTO payment_v2.wallet_accounts(user_id,network_id,wallet,token_account,proof_digest)
  VALUES((r.value->>'id')::uuid,(f->>'networkId')::uuid,payment_v2.unb58(r.value->>'wallet'),payment_v2.unb58(r.value->>'token'),sha256(convert_to(r.value::text,'UTF8')));
 END LOOP;
END $$;
COMMIT;
