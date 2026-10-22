-- 083 seller-signed listing floor: acceptance suite. psql only, never npm/test discovery.
-- Runs as the test administrator on flexsoar_payment_v2_test with 078..083 applied. One transaction, rolled back.
-- Stages: V wire vector (shared with protocol.rs and tests/solana-listing-v2.test.ts), D default no-op, R record_listing
-- refusals and acceptance, A attempt floor/expiry, P policy (required), I immutability and privileges.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
DO $pre$ BEGIN
 IF to_regclass('payment_v2.sale_listings') IS NULL THEN RAISE EXCEPTION 'apply 083 first';END IF;
END $pre$;

-- The listing message for a sale, built from the DB row exactly as the program and lib/solana/listing-v2.ts build it.
CREATE FUNCTION pg_temp.listing(p_sale uuid,p_min numeric,p_exp bigint) RETURNS bytea LANGUAGE plpgsql AS $$
DECLARE s record;n payment_v2.networks;v bytea;
BEGIN
 SELECT network_snapshot,sale_commitment,generation,card_id INTO s FROM payment_v2.sales WHERE id=p_sale;
 n:=s.network_snapshot;SELECT card_commitment INTO v FROM payment_v2.inventory WHERE card_id=s.card_id;
 RETURN decode('46534f415256322d4c49535400','hex')||sha256((n).genesis||(n).program||v||s.sale_commitment||payment_v2.le64(s.generation))||payment_v2.le64(p_min)||payment_v2.le64(p_exp);
END $$;
CREATE FUNCTION pg_temp.now_s() RETURNS bigint LANGUAGE sql AS $$ SELECT extract(epoch FROM clock_timestamp())::bigint $$;
CREATE FUNCTION pg_temp.sig() RETURNS bytea LANGUAGE sql AS $$ SELECT decode(repeat('5a',64),'hex') $$;
CREATE FUNCTION pg_temp.stage(p text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'T088|PASS|%',p;END $$;

-- V. One vector across Rust, TypeScript and SQL: 4 x 32-byte fields of 0x01..0x04, generation 5, floor 1_000_000, expiry 1_900_000_000.
DO $v$
DECLARE binding bytea;msg bytea;
BEGIN
 binding:=sha256(decode(repeat('01',32)||repeat('02',32)||repeat('03',32)||repeat('04',32),'hex')||payment_v2.le64(5));
 PERFORM pg_temp.assert_true(encode(binding,'hex')='4f9cc37436893a4b2c837ac87fd40271bd5cce559c2a7534a853318aa259784f','binding matches the Rust/TS vector');
 msg:=decode('46534f415256322d4c49535400','hex')||binding||payment_v2.le64(1000000)||payment_v2.le64(1900000000);
 PERFORM pg_temp.assert_true(octet_length(msg)=61,'61 bytes');
 PERFORM pg_temp.assert_true(encode(sha256(msg),'hex')='f7125fc0f364c4134469517178192ce16d44875818d6cd30e5768cdf28de9830','message digest matches the Rust/TS vector');
 PERFORM pg_temp.stage('V wire vector identical in SQL, Rust and TypeScript');
END $v$;

CREATE TEMP TABLE fx(name text PRIMARY KEY,f jsonb NOT NULL);
CREATE FUNCTION pg_temp.f(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT f FROM fx WHERE name=p $$;

-- D. Default policy changes nothing: a full fixture (sale, attempt, authorize, funded event) works with no listing.
DO $d$
BEGIN
 PERFORM pg_temp.assert_true((SELECT NOT required AND tolerance_bps=200 FROM payment_v2.listing_policy),'initial policy is (not required, 200 bps)');
 INSERT INTO fx VALUES('plain',pg_temp.fixture(0::smallint));
 PERFORM pg_temp.assert_true((SELECT state='authorized' FROM payment_v2.attempts WHERE id=(pg_temp.f('plain')->>'attempt')::uuid),'attempt authorizes without any listing');
 PERFORM pg_temp.stage('D default policy is a no-op');
END $d$;

-- R. record_listing: every refusal, then the boundary acceptance. Total 5_000_000 => the floor must be 4_900_000..5_000_000.
DO $r$
DECLARE f jsonb;sale uuid;other uuid;exp bigint:=pg_temp.now_s()+7200;m bytea;
BEGIN
 INSERT INTO fx VALUES('a',pg_temp.fixture(0::smallint,600,false)),('b',pg_temp.fixture(0::smallint,600,false));
 f:=pg_temp.f('a');sale:=(f->>'sale')::uuid;other:=(pg_temp.f('b')->>'sale')::uuid;
 m:=pg_temp.listing(sale,4900000,exp);
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,substring(m FROM 1 FOR 60),pg_temp.sig()),'LISTING_MALFORMED');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,m,substring(pg_temp.sig() FROM 1 FOR 63)),'LISTING_MALFORMED');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,set_byte(m,0,0),pg_temp.sig()),'LISTING_MALFORMED');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,pg_temp.listing(other,4900000,exp),pg_temp.sig()),'LISTING_BINDING');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,pg_temp.listing(sale,4899999,exp),pg_temp.sig()),'FLOOR_OUT_OF_TOLERANCE');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,pg_temp.listing(sale,5000001,exp),pg_temp.sig()),'FLOOR_OUT_OF_TOLERANCE');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,pg_temp.listing(sale,1,exp),pg_temp.sig()),'FLOOR_OUT_OF_TOLERANCE');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,pg_temp.listing(sale,4900000,pg_temp.now_s()-1),pg_temp.sig()),'LISTING_EXPIRY');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,pg_temp.listing(sale,4900000,pg_temp.now_s()+300),pg_temp.sig()),'LISTING_EXPIRY'); -- must outlive the quote (600 s)
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',gen_random_uuid(),m,pg_temp.sig()),'SALE_MISSING');
 PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM payment_v2.sale_listings WHERE sale_id=sale),'no refused attempt stored anything');
 -- The floor exactly 2% under the quote is accepted (boundary), and so is a floor equal to the quote.
 PERFORM public.fn_payment_v2_record_listing(sale,m,pg_temp.sig());
 PERFORM pg_temp.assert_true((SELECT min_total_units=4900000 AND expires_at=exp AND signer=(SELECT seller_wallet FROM payment_v2.sales WHERE id=sale) AND binding=substring(message FROM 14 FOR 32) FROM payment_v2.sale_listings WHERE sale_id=sale),'listing stored with the sale''s own seller wallet');
 PERFORM public.fn_payment_v2_record_listing(sale,m,pg_temp.sig());
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM payment_v2.sale_listings WHERE sale_id=sale),'exact retry is a no-op');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',sale,pg_temp.listing(sale,5000000,exp),pg_temp.sig()),'LISTING_CONFLICT');
 PERFORM public.fn_payment_v2_record_listing(other,pg_temp.listing(other,5000000,exp),pg_temp.sig());
 PERFORM pg_temp.assert_true((SELECT min_total_units=5000000 FROM payment_v2.sale_listings WHERE sale_id=other),'floor equal to the quote accepted');
 f:=public.fn_payment_v2_listing_for_open(sale);
 PERFORM pg_temp.assert_true(f->>'messageHex'=encode(m,'hex') AND f->>'signatureHex'=encode(pg_temp.sig(),'hex') AND f->>'minTotalUnits'='4900000' AND f->>'expiresAt'=exp::text
   AND f->>'signer'=payment_v2.b58((SELECT seller_wallet FROM payment_v2.sales WHERE id=sale)),'listing_for_open returns exactly what the worker needs');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_listing_for_open(%L)',gen_random_uuid()),'LISTING_MISSING');
 PERFORM pg_temp.stage('R record_listing: 10 refusals, boundary acceptance, retry, conflict');
END $r$;

-- A. Attempts. a (floor 4_900_000, attempt total 5_000_000) authorizes; direct rows below the floor / after expiry are refused.
DO $a$
DECLARE exp bigint:=pg_temp.now_s()+7200;below uuid;late uuid;
BEGIN
 PERFORM public.fn_payment_v2_authorize_attempt((pg_temp.f('a')->>'attempt')::uuid);
 PERFORM pg_temp.assert_true((SELECT state='authorized' FROM payment_v2.attempts WHERE id=(pg_temp.f('a')->>'attempt')::uuid),'attempt at or above the floor authorizes');
 INSERT INTO fx VALUES('below',pg_temp.fixture(0::smallint,600,false)),('late',pg_temp.fixture(0::smallint,600,false));
 below:=(pg_temp.f('below')->>'sale')::uuid;late:=(pg_temp.f('late')->>'sale')::uuid;
 -- These bypass record_listing (admin insert), standing in for an FX move or a lapse after the listing was recorded.
 INSERT INTO payment_v2.sale_listings(sale_id,message,signature,signer,binding,min_total_units,expires_at)
  SELECT below,m,pg_temp.sig(),(SELECT seller_wallet FROM payment_v2.sales WHERE id=below),substring(m FROM 14 FOR 32),5000001,exp FROM (SELECT pg_temp.listing(below,5000001,exp) m) x;
 INSERT INTO payment_v2.sale_listings(sale_id,message,signature,signer,binding,min_total_units,expires_at)
  SELECT late,m,pg_temp.sig(),(SELECT seller_wallet FROM payment_v2.sales WHERE id=late),substring(m FROM 14 FOR 32),4900000,pg_temp.now_s()-1 FROM (SELECT pg_temp.listing(late,4900000,pg_temp.now_s()-1) m) x;
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_authorize_attempt(%L)',pg_temp.f('below')->>'attempt'),'BELOW_SELLER_FLOOR');
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_authorize_attempt(%L)',pg_temp.f('late')->>'attempt'),'LISTING_EXPIRED');
 PERFORM pg_temp.assert_true((SELECT bool_and(state<>'authorized' AND permit IS NULL) FROM payment_v2.attempts WHERE id IN((pg_temp.f('below')->>'attempt')::uuid,(pg_temp.f('late')->>'attempt')::uuid)),'refused attempts stay unauthorized with no permit');
 PERFORM pg_temp.stage('A attempt at the floor authorizes; below the floor and after expiry are refused');
END $a$;

-- P. Policy: refused while funding is on; once off, 'required' blocks any attempt on a sale with no listing.
DO $p$
DECLARE exp bigint:=pg_temp.now_s()+7200;req uuid;
BEGIN
 INSERT INTO fx VALUES('req',pg_temp.fixture(0::smallint,600,false));
 req:=(pg_temp.f('req')->>'sale')::uuid;
 PERFORM pg_temp.expect_error('UPDATE payment_v2.listing_policy SET required=true','FUNDING_ENABLED');
 UPDATE payment_v2.networks SET funding_enabled=false WHERE funding_enabled;
 UPDATE payment_v2.listing_policy SET required=true;
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM payment_v2.configuration_history WHERE entity='listing_policy'),'policy change is audited (initial + change)');
 PERFORM pg_temp.assert_true((SELECT after_value->>'required'='true' AND before_value->>'required'='false' FROM payment_v2.configuration_history WHERE entity='listing_policy' ORDER BY id DESC LIMIT 1),'audit holds before and after');
 -- Funding is switched back on later by governance (082); the policy now applies to attempts.
 UPDATE payment_v2.networks SET funding_enabled=true;
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_authorize_attempt(%L)',pg_temp.f('req')->>'attempt'),'LISTING_REQUIRED');
 PERFORM public.fn_payment_v2_record_listing(req,pg_temp.listing(req,4900000,exp),pg_temp.sig());
 PERFORM public.fn_payment_v2_authorize_attempt((pg_temp.f('req')->>'attempt')::uuid);
 PERFORM pg_temp.assert_true((SELECT state='authorized' FROM payment_v2.attempts WHERE id=(pg_temp.f('req')->>'attempt')::uuid),'with a listing recorded the attempt authorizes');
 -- A brand-new sale with no listing cannot even start an attempt (the INSERT path), not only authorize.
 PERFORM pg_temp.expect_error('SELECT pg_temp.fixture(0::smallint,600,false)','LISTING_REQUIRED');
 PERFORM pg_temp.expect_error('UPDATE payment_v2.listing_policy SET required=false','FUNDING_ENABLED');
 PERFORM pg_temp.stage('P policy: guarded flip, audited, required blocks both attempt creation and authorization');
END $p$;

-- I. Immutability and privileges.
DO $i$
BEGIN
 PERFORM pg_temp.expect_error('UPDATE payment_v2.sale_listings SET min_total_units=1','IMMUTABLE');
 PERFORM pg_temp.expect_error('DELETE FROM payment_v2.sale_listings','IMMUTABLE');
 PERFORM pg_temp.expect_error('DELETE FROM payment_v2.listing_policy','IMMUTABLE');
 PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','public.fn_payment_v2_record_listing(uuid,bytea,bytea)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_payment_v2_listing_for_open(uuid)','EXECUTE')
   AND NOT has_function_privilege('payment_v2_verifier','public.fn_payment_v2_record_listing(uuid,bytea,bytea)','EXECUTE') AND has_function_privilege('payment_v2_issuer','public.fn_payment_v2_record_listing(uuid,bytea,bytea)','EXECUTE'),'only the issuer role may call the listing RPCs');
 PERFORM pg_temp.assert_true(NOT has_table_privilege('payment_v2_issuer','payment_v2.sale_listings','SELECT') AND NOT has_table_privilege('authenticated','payment_v2.listing_policy','SELECT'),'tables are owner-only');
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.expect_error(format('SELECT public.fn_payment_v2_record_listing(%L,%L,%L)',gen_random_uuid(),decode(repeat('00',61),'hex'),pg_temp.sig()),'permission denied');
 RESET ROLE;
 PERFORM pg_temp.stage('I immutable rows, owner-only tables, issuer-only RPCs');
END $i$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'T088|SUITE_PASS';
