\set ON_ERROR_STOP on
BEGIN;
DO $$BEGIN IF current_database()<>'flexsoar_payment_v2_integration_test' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR session_user<>'supabase_admin' THEN RAISE EXCEPTION 'integration inventory target mismatch';END IF;END $$;
CREATE TEMP TABLE fixture_input(value jsonb);
INSERT INTO fixture_input VALUES(:'fixture'::jsonb);
DO $$DECLARE f jsonb;s uuid;m uuid;sk uuid;i uuid;c uuid;l uuid;mode smallint;BEGIN
 SELECT value INTO f FROM fixture_input;s:=(f->>'sellerId')::uuid;m:=(f->>'modelId')::uuid;sk:=(f->>'skuId')::uuid;i:=(f->>'itemId')::uuid;c:=(f->>'cardId')::uuid;l:=(f->>'listingId')::uuid;mode:=(f->>'mode')::smallint;
 INSERT INTO public.sku_models(id,brand,model,colorway,base_price_cents) VALUES(m,'Synthetic','Integration-'||m,'Test',2000);
 INSERT INTO public.skus(id,model_id,brand,model,colorway,size_us) VALUES(sk,m,'Synthetic','Integration','Test',10);
 INSERT INTO public.items(id,sku_id,consignor_id,status,float_value,custody,custody_holder_id) VALUES(i,sk,s,'minted',0.1,CASE mode WHEN 0 THEN 'seller'::public.custody_model ELSE 'warehouse'::public.custody_model END,CASE mode WHEN 0 THEN s END);
 INSERT INTO public.cards(id,item_id,sku_id,owner_id,float_value,tier,mint_number) VALUES(c,i,sk,s,0.1,1,1);
 INSERT INTO public.ledger_entries(txn_id,entry_type,asset,account_id,card_id,direction) VALUES(gen_random_uuid(),'mint','card',s,c,1);
 INSERT INTO public.listings(id,card_id,seller_id,price_cents,status,payout_method) VALUES(l,c,s,2000,'public','cash');
 INSERT INTO payment_v2.inventory(card_id,item_id,card_commitment,pair_commitment,custody_version,mode,enrollment_evidence,enrolled_by,approved_by)
 VALUES(c,i,sha256(uuid_send(c)),sha256(uuid_send(i)),1,mode,sha256(uuid_send(i)),(f->>'inventoryStaff')::uuid,(f->>'reviewerStaff')::uuid);
END $$;
COMMIT;
