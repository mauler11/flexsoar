-- Rename the attempt-branch sales alias (s -> sl) so it no longer collides with the
-- function's PL/pgSQL row variable s (42702). Self-relative guards: the only permitted
-- change is the two single-line fragment substitutions below; metadata, owner, ACL,
-- SECURITY DEFINER and search_path must be identical before and after.
BEGIN;
CREATE TEMP TABLE payment_v2_verifier_alias_before ON COMMIT DROP AS
 SELECT fn.oid,fn.proowner,fn.proacl,fn.prosecdef,fn.proconfig,fn.provolatile,fn.proisstrict,
  fn.proparallel,fn.proleakproof,pg_get_function_identity_arguments(fn.oid) AS identity_args,
  pg_get_function_result(fn.oid) AS result_type,to_jsonb(fn)-'prosrc' AS metadata,fn.prosrc,
  'jsonb_build_object(''formatVersion'',1,''kind'',''attempt'',''attemptId'',a.id,''saleId'',s.id,''listingId'',s.listing_id,''cardId'',s.card_id,''itemId'',s.item_id,''buyerId'',a.buyer_id,''sellerId'',s.seller_id,''networkId'',s.network_id,''genesis'',payment_v2.b58((s.network_snapshot).genesis),''program'',payment_v2.b58((s.network_snapshot).program),''config'',payment_v2.b58((s.network_snapshot).config),''sale'',payment_v2.b58(s.sale_address),''attemptCommitment'',payment_v2.b58(a.attempt_commitment),''permitHex'',encode(a.permit,''hex''),''mode'',s.mode,''generation'',s.generation::text,''revision'',s.revision::text,''custodyVersion'',s.custody_version::text,''buyerWallet'',payment_v2.b58(a.buyer_wallet),''sellerWallet'',payment_v2.b58(a.seller_wallet),''buyerToken'',payment_v2.b58(a.buyer_token),''sellerToken'',payment_v2.b58(a.seller_token),''treasuryToken'',payment_v2.b58(a.treasury_token),''refundToken'',payment_v2.b58(a.refund_token),''totalUnits'',a.total_units::text,''netUnits'',a.net_units::text,''feeUnits'',a.fee_units::text,''validFrom'',a.valid_from::text,''expiresAt'',a.expires_at::text)'::text AS frag1_old,
  'jsonb_build_object(''formatVersion'',1,''kind'',''attempt'',''attemptId'',a.id,''saleId'',sl.id,''listingId'',sl.listing_id,''cardId'',sl.card_id,''itemId'',sl.item_id,''buyerId'',a.buyer_id,''sellerId'',sl.seller_id,''networkId'',sl.network_id,''genesis'',payment_v2.b58((sl.network_snapshot).genesis),''program'',payment_v2.b58((sl.network_snapshot).program),''config'',payment_v2.b58((sl.network_snapshot).config),''sale'',payment_v2.b58(sl.sale_address),''attemptCommitment'',payment_v2.b58(a.attempt_commitment),''permitHex'',encode(a.permit,''hex''),''mode'',sl.mode,''generation'',sl.generation::text,''revision'',sl.revision::text,''custodyVersion'',sl.custody_version::text,''buyerWallet'',payment_v2.b58(a.buyer_wallet),''sellerWallet'',payment_v2.b58(a.seller_wallet),''buyerToken'',payment_v2.b58(a.buyer_token),''sellerToken'',payment_v2.b58(a.seller_token),''treasuryToken'',payment_v2.b58(a.treasury_token),''refundToken'',payment_v2.b58(a.refund_token),''totalUnits'',a.total_units::text,''netUnits'',a.net_units::text,''feeUnits'',a.fee_units::text,''validFrom'',a.valid_from::text,''expiresAt'',a.expires_at::text)'::text AS frag1_new,
  'FROM payment_v2.attempts a JOIN payment_v2.sales s ON s.id=a.sale_id'::text AS frag2_old,
  'FROM payment_v2.attempts a JOIN payment_v2.sales sl ON sl.id=a.sale_id'::text AS frag2_new
 FROM pg_proc fn WHERE fn.oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;

DO $preguard$
DECLARE v_overloads bigint;v_rows bigint;v_src text;v_f1 text;v_f2 text;v_n1 text;v_n2 text;v_secdef boolean;v_config text[];
BEGIN
 SELECT count(*) INTO v_overloads FROM pg_proc
  WHERE proname='fn_payment_v2_verifier_context' AND pronamespace='public'::regnamespace;
 IF v_overloads<>1 THEN
  RAISE EXCEPTION '074: expected exactly one public.fn_payment_v2_verifier_context overload, found %',v_overloads;
 END IF;
 SELECT count(*) INTO v_rows FROM payment_v2_verifier_alias_before;
 IF v_rows<>1 THEN RAISE EXCEPTION '074: snapshot captured % rows, expected 1',v_rows;END IF;
 SELECT snap.prosrc,snap.frag1_old,snap.frag2_old,snap.frag1_new,snap.frag2_new,snap.prosecdef,snap.proconfig
  INTO v_src,v_f1,v_f2,v_n1,v_n2,v_secdef,v_config FROM payment_v2_verifier_alias_before snap;
 IF v_src IS NULL THEN RAISE EXCEPTION '074: snapshot prosrc is NULL';END IF;
 IF position('ORDER BY a.staff_id' IN v_src)=0 OR position('ORDER BY g.staff_id' IN v_src)>0 THEN
  RAISE EXCEPTION '074: 070 governance-order fix not present as expected; inspect catalog before repair';
 END IF;
 IF (length(v_src)-length(replace(v_src,v_f1,'')))/length(v_f1)<>1
  OR (length(v_src)-length(replace(v_src,v_f2,'')))/length(v_f2)<>1 THEN
  RAISE EXCEPTION '074: each repair fragment must occur exactly once in prosrc (frag1 %, frag2 %)',
   (length(v_src)-length(replace(v_src,v_f1,'')))/length(v_f1),(length(v_src)-length(replace(v_src,v_f2,'')))/length(v_f2);
 END IF;
 IF (length(replace(v_src,v_f1,v_n1))-length(replace(replace(v_src,v_f1,v_n1),v_f2,'')))/length(v_f2)<>1 THEN
  RAISE EXCEPTION '074: frag2 occurrence count changed after frag1 substitution';
 END IF;
 IF position(E'\n' IN v_f1||v_f2||v_n1||v_n2)>0 OR position(E'\r' IN v_f1||v_f2||v_n1||v_n2)>0 THEN
  RAISE EXCEPTION '074: repair fragments must not contain a line terminator';
 END IF;
 IF v_src ~ E'\\msl\\M' THEN RAISE EXCEPTION '074: identifier sl already present in prosrc';END IF;
 IF v_secdef IS DISTINCT FROM true OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION '074: verifier context is not SECURITY DEFINER with search_path=pg_catalog';
 END IF;
END $preguard$;

DO $repair$
DECLARE v_definition text;v_f1 text;v_f2 text;v_n1 text;v_n2 text;
BEGIN
 SELECT snap.frag1_old,snap.frag2_old,snap.frag1_new,snap.frag2_new INTO v_f1,v_f2,v_n1,v_n2
  FROM payment_v2_verifier_alias_before snap;
 SELECT pg_get_functiondef(oid) INTO v_definition FROM pg_proc
  WHERE oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;
 IF (length(v_definition)-length(replace(v_definition,v_f1,'')))/length(v_f1)<>1
  OR (length(v_definition)-length(replace(v_definition,v_f2,'')))/length(v_f2)<>1 THEN
  RAISE EXCEPTION '074: repair fragments not found exactly once in pg_get_functiondef output';
 END IF;
 EXECUTE replace(replace(v_definition,v_f1,v_n1),v_f2,v_n2);
END $repair$;

DO $postguard$
BEGIN
 IF (SELECT count(*) FROM pg_proc
     WHERE proname='fn_payment_v2_verifier_context' AND pronamespace='public'::regnamespace)<>1 THEN
  RAISE EXCEPTION '074: overload count changed during repair';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_v2_verifier_alias_before snap JOIN pg_proc live ON live.oid IS NOT DISTINCT FROM snap.oid
  WHERE live.oid IS NOT DISTINCT FROM 'public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure
   AND live.proowner IS NOT DISTINCT FROM snap.proowner
   AND live.proacl IS NOT DISTINCT FROM snap.proacl
   AND live.prosecdef IS NOT DISTINCT FROM snap.prosecdef
   AND live.proconfig IS NOT DISTINCT FROM snap.proconfig
   AND live.provolatile IS NOT DISTINCT FROM snap.provolatile
   AND live.proisstrict IS NOT DISTINCT FROM snap.proisstrict
   AND live.proparallel IS NOT DISTINCT FROM snap.proparallel
   AND live.proleakproof IS NOT DISTINCT FROM snap.proleakproof
   AND pg_get_function_identity_arguments(live.oid) IS NOT DISTINCT FROM snap.identity_args
   AND pg_get_function_result(live.oid) IS NOT DISTINCT FROM snap.result_type
   AND (to_jsonb(live)-'prosrc') IS NOT DISTINCT FROM snap.metadata
   AND live.prosrc IS NOT DISTINCT FROM replace(replace(snap.prosrc,snap.frag1_old,snap.frag1_new),snap.frag2_old,snap.frag2_new)
   AND position('JOIN payment_v2.sales s ON s.id=a.sale_id' IN live.prosrc)=0
   AND live.prosecdef IS NOT DISTINCT FROM true) THEN
  RAISE EXCEPTION '074: verifier context changed beyond the attempt-branch sales alias rename; rolling back';
 END IF;
END $postguard$;
COMMIT;
