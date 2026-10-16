-- DRAFT ONLY. Include inside guarded test transaction. No operational identities.
CREATE FUNCTION pg_temp.assert_true(p boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',label;END IF;END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN
  IF strpos(SQLERRM,fragment)=0 THEN RAISE EXCEPTION 'unexpected error: % (wanted %)',SQLERRM,fragment;END IF;RETURN;
 END;RAISE EXCEPTION 'expected rejection: %',statement;
END $$;
-- Synthetic rows only; no data copied from Panda, production, customer records or wallets.
CREATE FUNCTION pg_temp.fixture(mode smallint,valid_seconds integer DEFAULT 600,record_evidence boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE seller uuid:=gen_random_uuid();buyer uuid:=gen_random_uuid();model uuid:=gen_random_uuid();sku uuid:=gen_random_uuid();item uuid:=gen_random_uuid();card uuid:=gen_random_uuid();listing uuid:=gen_random_uuid();net uuid:=gen_random_uuid();sale uuid:=gen_random_uuid();u uuid;st uuid;enroller uuid;reviewer uuid;i int;role_name text;status jsonb;permit text;proof jsonb;event uuid;funded bigint:=extract(epoch FROM clock_timestamp())::bigint;
BEGIN
 INSERT INTO public.users(id,auth_id,handle,email,country_code,solana_address) VALUES
 (seller,seller,'s-'||left(replace(seller::text,'-',''),22),'seller-'||seller||'@example.invalid','MY',payment_v2.b58(sha256(uuid_send(seller)))),
 (buyer,buyer,'b-'||left(replace(buyer::text,'-',''),22),'buyer-'||buyer||'@example.invalid','MY',payment_v2.b58(sha256(uuid_send(buyer))));
 FOR i IN 1..10 LOOP
  u:=gen_random_uuid();st:=gen_random_uuid();role_name:=(ARRAY['inventory','reviewer','receiver','authenticator','release','governor','governor','governor','guardian','reconciler'])[i];
  INSERT INTO public.users(id,auth_id,handle,email,country_code) VALUES(u,u,'st-'||left(replace(u::text,'-',''),21),'staff-'||u||'@example.invalid','MY');
  -- One shared configured staff set across fixtures, to preserve exactly three governance persons.
  IF (role_name='governor' AND (SELECT count(1) FROM payment_v2.staff WHERE role='governor')<3) OR (role_name<>'governor' AND NOT EXISTS(SELECT 1 FROM payment_v2.staff WHERE role=role_name)) THEN
   INSERT INTO payment_v2.staff(id,user_id,person_id,role,public_key) VALUES(st,u,u,role_name,sha256(uuid_send(u)));
  END IF;
 END LOOP;
 SELECT id INTO enroller FROM payment_v2.staff WHERE role='inventory';SELECT id INTO reviewer FROM payment_v2.staff WHERE role='reviewer';
 INSERT INTO public.sku_models(id,brand,model,colorway,base_price_cents) VALUES(model,'Synthetic','Payment-'||model,'Test',2000);
 INSERT INTO public.skus(id,model_id,brand,model,colorway,size_us) VALUES(sku,model,'Synthetic','Derived','Test',10);
 INSERT INTO public.items(id,sku_id,consignor_id,status,float_value,custody,custody_holder_id) VALUES(item,sku,seller,'minted',0.1,CASE mode WHEN 0 THEN 'seller'::public.custody_model ELSE 'warehouse'::public.custody_model END,CASE mode WHEN 0 THEN seller END);
 INSERT INTO public.cards(id,item_id,sku_id,owner_id,float_value,tier,mint_number) VALUES(card,item,sku,seller,0.1,1,1);
 INSERT INTO public.ledger_entries(txn_id,entry_type,asset,account_id,card_id,direction) VALUES(gen_random_uuid(),'mint','card',seller,card,1);
 INSERT INTO public.listings(id,card_id,seller_id,price_cents,status,payout_method) VALUES(listing,card,seller,2000,'public','cash');
 -- A separate historical listing/order predates v2 enrollment. Do not relabel its direct payment.
 u:=gen_random_uuid();
 INSERT INTO public.listings(id,card_id,seller_id,price_cents,status,payout_method) VALUES(u,card,seller,2000,'sold','cash');
 INSERT INTO public.orders(listing_id,card_id,buyer_id,seller_id,gross_cents,fee_bps,fee_cents,net_cents,settlement_ref,status,seller_payout)
 VALUES(u,card,buyer,seller,2000,500,100,1900,'sol:synthetic-legacy-'||u,'settled','cash');
 INSERT INTO payment_v2.inventory(card_id,item_id,card_commitment,pair_commitment,custody_version,mode,enrollment_evidence,enrolled_by,approved_by)
 VALUES(card,item,sha256(uuid_send(card)),sha256(uuid_send(item)),1,mode,sha256(uuid_send(item)),enroller,reviewer);
 INSERT INTO payment_v2.networks(id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units)
 VALUES(net,sha256(uuid_send(net)),sha256(uuid_send(model)),sha256(uuid_send(sku)),sha256(uuid_send(item)),sha256(uuid_send(card)),sha256(uuid_send(listing)),sha256(uuid_send(sale)),sha256(uuid_send(reviewer)),1,'MY-USDC-ESCROW-1',true,50000000,100000000);
 INSERT INTO payment_v2.wallet_accounts(user_id,network_id,wallet,token_account,proof_digest) VALUES(seller,net,sha256(uuid_send(seller)),sha256(uuid_send(seller)||decode('01','hex')),sha256(uuid_send(seller))),
 (buyer,net,sha256(uuid_send(buyer)),sha256(uuid_send(buyer)||decode('01','hex')),sha256(uuid_send(buyer)));
 PERFORM public.fn_payment_v2_prepare_sale(listing,net,jsonb_build_object('id',sale,'saleAddress',payment_v2.b58(sha256(uuid_send(sale))),'escrowAddress',payment_v2.b58(sha256(uuid_send(sale)||decode('02','hex'))),'totalUnits','5000000','fxSnapshot',jsonb_build_object('myrSen',2000,'usdcBaseUnits','5000000','source','synthetic'),'validFrom',funded-10,'expiresAt',funded+valid_seconds));
 proof:=jsonb_build_object('saleId',sale,'kind','opened','finality','finalized','sale',payment_v2.b58(sha256(uuid_send(sale))),'genesis',payment_v2.b58(sha256(uuid_send(net))),'program',payment_v2.b58(sha256(uuid_send(model))),'generation','1','revision','1','signature',repeat('2',88),'slot',1);
 PERFORM public.fn_payment_v2_record_lifecycle(proof);
 PERFORM set_config('request.jwt.claim.sub',buyer::text,true);
 status:=public.fn_payment_v2_initiate(listing,gen_random_uuid(),'MY-USDC-ESCROW-1','834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5');
 IF record_evidence THEN permit:=public.fn_payment_v2_authorize_attempt((status->>'id')::uuid);END IF;
 proof:=jsonb_build_object('kind',CASE mode WHEN 0 THEN 'funded' ELSE 'direct' END,'signature',repeat('3',88),'slot',2,'fundedAtSeconds',funded::text,'decisionRevision','0','permitHex',permit,'genesis',proof->>'genesis','program',proof->>'program','sale',proof->>'sale','attempt',payment_v2.b58(sha256(uuid_send((status->>'id')::uuid))),'finality','finalized');
 IF record_evidence THEN event:=public.fn_payment_v2_record_verified_event(proof);END IF;
 RETURN jsonb_build_object('issuerTerms',(SELECT issuer_terms FROM payment_v2.sales WHERE id=sale),'seller',seller,'buyer',buyer,'card',card,'item',item,'listing',listing,'network',net,'sale',sale,'attempt',status->>'id','permit',permit,'event',event,'proof',proof);
END $$;
