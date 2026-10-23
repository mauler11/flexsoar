-- 084 wallet enrollment and read-view acceptance suite. psql only; one isolated transaction, rolled back.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
DO $pre$ BEGIN
 IF to_regprocedure('public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)') IS NULL
  OR to_regprocedure('public.fn_payment_v2_listing_view(uuid)') IS NULL
  OR to_regprocedure('public.fn_payment_v2_governance_projection()') IS NULL
  OR to_regprocedure('public.fn_payment_v2_open_sale_queue(integer)') IS NULL THEN RAISE EXCEPTION 'apply 084 first';END IF;
END $pre$;
CREATE TEMP TABLE fx(name text PRIMARY KEY,f jsonb NOT NULL);
INSERT INTO fx SELECT 'unsigned-'||n,pg_temp.fixture(0::smallint,600,false) FROM generate_series(1,20) n;
INSERT INTO fx VALUES('one',pg_temp.fixture(0::smallint,600,false)),('two',pg_temp.fixture(0::smallint,600,false));
-- fixture() records the synthetic opened event; restore only its synthetic rows to the pre-open phase under test.
UPDATE payment_v2.sales SET state='opening' WHERE id=(SELECT (f->>'sale')::uuid FROM fx WHERE name='one');
UPDATE payment_v2.operations SET state='pending',lease_id=NULL,leased_by=NULL,lease_until=NULL
 WHERE sale_id=(SELECT (f->>'sale')::uuid FROM fx WHERE name='one') AND action='open_sale';
CREATE FUNCTION pg_temp.f(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT f FROM fx WHERE name=p $$;
CREATE FUNCTION pg_temp.new_wallet_user(p_country text,p_address text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid:=gen_random_uuid();
BEGIN INSERT INTO public.users(id,auth_id,handle,email,country_code,solana_address)
 VALUES(u,u,'w84-'||left(replace(u::text,'-',''),16),'w84-'||u||'@example.invalid',p_country,p_address);RETURN u;END $$;
CREATE FUNCTION pg_temp.stage(p text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'T089|PASS|%',p;END $$;

-- W. A fresh MY wallet can enroll and an exact retry has no second effect.
DO $w$
DECLARE f jsonb:=pg_temp.f('one');u uuid:=pg_temp.new_wallet_user('MY',payment_v2.b58(sha256(convert_to('w84-wallet','UTF8'))));
 net uuid:=(f->>'network')::uuid;v_wallet bytea:=sha256(convert_to('w84-wallet','UTF8'));v_token bytea:=sha256(convert_to('w84-token','UTF8'));v_proof bytea:=sha256(convert_to('w84-proof','UTF8'));
BEGIN
 SET LOCAL ROLE payment_v2_issuer;
 PERFORM public.fn_payment_v2_enroll_wallet(u,net,v_wallet,v_token,v_proof);
 PERFORM public.fn_payment_v2_enroll_wallet(u,net,v_wallet,v_token,v_proof);
 RESET ROLE;
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM payment_v2.wallet_accounts w WHERE w.user_id=u AND w.network_id=net AND w.wallet=v_wallet),'enrollment and exact retry create one immutable row');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_enroll_wallet(%L,%L,%L,%L,%L)',u,net,v_wallet,v_token,sha256(convert_to('different proof','UTF8'))),'WALLET_ENROLLMENT_CONFLICT');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_enroll_wallet(%L,%L,%L,%L,%L)',u,net,v_wallet,sha256(convert_to('other token','UTF8')),v_proof),'WALLET_ENROLLMENT_CONFLICT');
 PERFORM pg_temp.stage('W enroll and exact retry; changed proof or token refuses');
END $w$;

-- I. Identity checks, network existence and token-account uniqueness refuse before writing.
DO $i$
DECLARE f jsonb:=pg_temp.f('one');net uuid:=(f->>'network')::uuid;wallet bytea:=sha256(convert_to('w84-i','UTF8'));proof bytea:=sha256(convert_to('w84-i-proof','UTF8'));
 nonmy uuid:=pg_temp.new_wallet_user('US',payment_v2.b58(wallet));badaddr uuid:=pg_temp.new_wallet_user('MY',payment_v2.b58(sha256(convert_to('other address','UTF8'))));
 u uuid:=pg_temp.new_wallet_user('MY',payment_v2.b58(wallet));token bytea:=sha256(convert_to('w84-duplicate-token','UTF8'));
 other_wallet bytea:=sha256(convert_to('second wallet','UTF8'));other_user uuid:=pg_temp.new_wallet_user('MY',payment_v2.b58(other_wallet));
BEGIN
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_enroll_wallet(%L,%L,%L,%L,%L)',nonmy,net,wallet,token,proof),'WALLET_USER_NOT_MY');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_enroll_wallet(%L,%L,%L,%L,%L)',badaddr,net,wallet,token,proof),'WALLET_ADDRESS_MISMATCH');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_enroll_wallet(%L,%L,%L,%L,%L)',u,gen_random_uuid(),wallet,token,proof),'WALLET_NETWORK_UNKNOWN');
 SET LOCAL ROLE payment_v2_issuer;
 PERFORM public.fn_payment_v2_enroll_wallet(u,net,wallet,token,proof);
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_enroll_wallet(%L,%L,%L,%L,%L)',other_user,net,other_wallet,token,proof),'WALLET_TOKEN_ACCOUNT_USED');
 RESET ROLE;
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM payment_v2.wallet_accounts WHERE network_id=net AND token_account=token),'token-account conflict leaves one row');
 PERFORM pg_temp.stage('I non-MY, mismatched address, unknown network and duplicate token account refuse');
END $i$;

-- A. Wrong worker roles cannot reach the wallet writer or issuer queue.
SET LOCAL ROLE payment_v2_verifier;
SELECT pg_temp.expect_error(format('SELECT public.fn_payment_v2_enroll_wallet(%L,%L,%L,%L,%L)',gen_random_uuid(),gen_random_uuid(),decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex')),'permission denied');
SELECT pg_temp.expect_error('SELECT public.fn_payment_v2_open_sale_queue(1)','permission denied');
RESET ROLE;
SELECT pg_temp.stage('A wrong worker role refused by ACL');

-- V. Authenticated owner receives only its signing inputs; a foreign seller is indistinguishable from a missing sale.
DO $v$
DECLARE f jsonb:=pg_temp.f('one');out jsonb;foreign_listing uuid:=(pg_temp.f('two')->>'listing')::uuid;
BEGIN
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub',f->>'seller',true);
 out:=public.fn_payment_v2_listing_view((f->>'listing')::uuid);
 PERFORM pg_temp.assert_true(out->>'saleId'=f->>'sale' AND out->>'listingId'=f->>'listing'
  AND out->>'quoteTotalUnits'='5000000' AND out->>'quoteValidFrom' IS NOT NULL AND out->>'quoteExpiresAt' IS NOT NULL
  AND out->>'toleranceBps'='200' AND out->>'cardCommitment' IS NOT NULL AND out->>'saleCommitment' IS NOT NULL,
  'seller signing view returns bound inputs and quote window');
 PERFORM set_config('request.jwt.claim.sub',f->>'buyer',true);
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_listing_view(%L)',(f->>'listing')::uuid),'LISTING_NOT_YOURS');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_listing_view(%L)',foreign_listing),'LISTING_NOT_YOURS');
 RESET ROLE;
 PERFORM pg_temp.stage('V signing view is seller-owned and refuses foreign listing ids');
END $v$;

-- G. Gate projection has one row and exactly the three strictly typed fields.
DO $g$
DECLARE n integer;keys text[];
BEGIN
 SELECT count(*) INTO n FROM public.fn_payment_v2_governance_projection();
 SELECT array_agg(j.key ORDER BY j.key) INTO keys FROM jsonb_object_keys((SELECT to_jsonb(p) FROM public.fn_payment_v2_governance_projection() p)) AS j(key);
 PERFORM pg_temp.assert_true(n=1 AND keys=ARRAY['governors_required','operational_separation','release_delay_seconds'],'projection has one row and only the gate fields');
 SET LOCAL ROLE payment_v2_verifier;
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.fn_payment_v2_governance_projection()),'verifier can read projection');
 RESET ROLE;
 PERFORM pg_temp.stage('G governance projection returns exactly one three-field row to verifier');
END $g$;

-- Q. Issuer queue contains only prepared sales with a persisted seller listing and enforces a bounded limit.
DO $q$
DECLARE f jsonb:=pg_temp.f('one');s uuid:=(f->>'sale')::uuid;m bytea;rows jsonb;
BEGIN
 -- Twenty older prepared sales deliberately lack stored seller listings. They must not
 -- consume the queue limit ahead of the later, fully eligible signed listing.
 UPDATE payment_v2.sales SET state='opening'
  WHERE id IN(SELECT (fx.f->>'sale')::uuid FROM fx WHERE name LIKE 'unsigned-%');
 UPDATE payment_v2.operations SET state='pending',lease_id=NULL,leased_by=NULL,lease_until=NULL
  WHERE action='open_sale' AND sale_id IN(SELECT (fx.f->>'sale')::uuid FROM fx WHERE name LIKE 'unsigned-%');
 UPDATE payment_v2.operations SET state='observed'
  WHERE action='open_sale' AND sale_id IN(SELECT (fx.f->>'sale')::uuid FROM fx WHERE name LIKE 'unsigned-%');
 WITH older AS (
  SELECT op.sale_id,op.payload,op.payload_digest,op.expected_revision,row_number() OVER(ORDER BY op.id) AS seq
  FROM payment_v2.operations op
  WHERE op.action='open_sale' AND op.sale_id IN(SELECT (fx.f->>'sale')::uuid FROM fx WHERE name LIKE 'unsigned-%')
 )
 INSERT INTO payment_v2.operations(sale_id,action,payload,payload_digest,expected_revision,ready,state,created_at)
 SELECT sale_id,'open_sale',payload,payload_digest,expected_revision,true,'pending',
  clock_timestamp()-interval '2 days'+seq*interval '1 second'
 FROM older;
 PERFORM pg_temp.assert_true((SELECT count(*)=20 AND max(op.created_at)<(SELECT signed.created_at FROM payment_v2.operations signed WHERE signed.action='open_sale' AND signed.sale_id=s)
  FROM payment_v2.operations op WHERE op.action='open_sale' AND op.state='pending'
   AND op.sale_id IN(SELECT (fx.f->>'sale')::uuid FROM fx WHERE name LIKE 'unsigned-%')),
  'all twenty unsigned prepared operations are older than the signed eligible operation');
 m:=decode('46534f415256322d4c49535400','hex')||sha256(convert_to('w84-binding','UTF8'))||decode(repeat('00',16),'hex');
 INSERT INTO payment_v2.sale_listings(sale_id,message,signature,signer,binding,min_total_units,expires_at)
 SELECT s,m,decode(repeat('5a',64),'hex'),seller_wallet,substring(m FROM 14 FOR 32),4900000,extract(epoch FROM clock_timestamp())::bigint+7200
 FROM payment_v2.sales WHERE id=s;
 SET LOCAL ROLE payment_v2_issuer;
 rows:=public.fn_payment_v2_open_sale_queue(1);
 PERFORM pg_temp.assert_true(jsonb_array_length(rows)=1 AND rows->0->>'saleId'=s::text AND rows->0->>'operationId' IS NOT NULL,
  'issuer queue filters all eligibility predicates before limit despite twenty older unsigned prepared sales');
 PERFORM pg_temp.expect_error('SELECT public.fn_payment_v2_open_sale_queue(21)','OPEN_SALE_LIMIT');
 RESET ROLE;
 PERFORM pg_temp.stage('Q issuer queue requires a persisted listing and bounded query');
END $q$;

-- P. Explicit ACL matrix: seller, verifier and issuer each have only their intended RPCs.
DO $p$
BEGIN
 PERFORM pg_temp.assert_true(has_function_privilege('authenticated','public.fn_payment_v2_listing_view(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)','EXECUTE')
  AND NOT has_function_privilege('payment_v2_verifier','public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)','EXECUTE')
  AND NOT has_function_privilege('payment_v2_executor','public.fn_payment_v2_open_sale_queue(integer)','EXECUTE')
  AND has_function_privilege('payment_v2_issuer','public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)','EXECUTE')
  AND has_function_privilege('payment_v2_verifier','public.fn_payment_v2_governance_projection()','EXECUTE'),
  'only named principals have the four RPC grants');
 PERFORM pg_temp.assert_true(NOT has_table_privilege('payment_v2_issuer','payment_v2.wallet_accounts','SELECT')
  AND NOT has_table_privilege('authenticated','payment_v2.governance_mode','SELECT'),'tables stay owner-only');
 PERFORM pg_temp.stage('P exact RPC grants; no direct table access');
END $p$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'T089|SUITE_PASS';
