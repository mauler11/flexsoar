-- Additive synthetic users only. Preserve the relinked user and every old binding.
\set ON_ERROR_STOP on
BEGIN;
DO $$BEGIN IF current_database()<>'flexsoar_payment_v2_integration_test' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR session_user<>'supabase_admin' THEN RAISE EXCEPTION 'integration buyer target mismatch';END IF;END $$;
CREATE TEMP TABLE buyer_input(value jsonb);
INSERT INTO buyer_input VALUES(:'fixture'::jsonb);
DO $$DECLARE f jsonb;b jsonb;u uuid;BEGIN
 SELECT value INTO f FROM buyer_input;
 FOR b IN SELECT value FROM jsonb_array_elements(f->'buyers') LOOP
  u:=(b->>'id')::uuid;
  INSERT INTO public.users(id,auth_id,handle,email,country_code,solana_address) VALUES(u,u,'i-'||left(replace(u::text,'-',''),22),u||'@integration.invalid','MY',b->>'wallet');
  INSERT INTO payment_v2.wallet_accounts(user_id,network_id,wallet,token_account,proof_digest) VALUES(u,(f->>'networkId')::uuid,payment_v2.unb58(b->>'wallet'),payment_v2.unb58(b->>'token'),sha256(convert_to(b::text,'UTF8')));
 END LOOP;
END $$;
COMMIT;
