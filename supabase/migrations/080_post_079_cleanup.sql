-- ============================================================================
-- 080_post_079_cleanup.sql
--
-- Founder rule (2026-10-21/22): vaulted = custody 'warehouse' AND
-- authenticated_at IS NOT NULL, and authenticated_at means FlexSoar physically
-- holds the pair AND has authenticated it. Seller review is neither (079).
-- Requires 079 applied (production and staging are both there). No arity
-- changes. One transaction; a guard failure rolls the whole file back.
--
-- 1. DATA. 079 stopped fn_approve_submission stamping authenticated_at/by but
--    relabelled nothing. Every item that is
--      custody <> 'warehouse' AND authenticated_at IS NOT NULL
--      AND review_approved_at IS NULL
--      AND no payment v2 authentication pass attestation for a sale of it
--    carries a seller-review stamp (pre-079 approval). It is moved:
--      review_approved_at/by := authenticated_at/by; authenticated_at/by := NULL.
--    Nothing else on the row changes.
--
--    Readers of items.authenticated_at/by (live catalog: functions, views,
--    triggers, policies, constraints; plus lib/, app/, components/):
--      fn_mint_card         read at mint only; seller custody is gated on
--                           review_approved_at since 079. A moved row is
--                           already minted.
--      fn_grade_item        promotes pending_intake/in_custody only; refuses
--                           any other status, so a minted item never reaches it.
--      fn_authenticate_item writer; warehouse custody only since 079.
--      fn_payment_v2_prepare_sale / payment_v2.correspondence (078)
--                           seller -> mode 0 without reading the stamp.
--      fn_payment_v2_record_attestation (078) receipt clears the stamp anyway.
--      fn_payment_v2_reconcile_event (061) writer at release, from the pass.
--      escrow release / payout: no reader. Mode 0 release depends on the
--                           attestation chain, never on the item stamp.
--      redemption           fn_redeem_card is retired (063) and the v2 redeem
--                           refuses (062); neither reads the stamp.
--      views / policies / indexes: none reference the columns; the only
--                           dependency is items_authenticated_by_fkey
--                           (NULL satisfies it).
--      app: vault-status.ts (seller -> "Held by seller" whatever the stamp),
--           admin "Authenticated at" (now correctly "-"), getItems
--           ({authenticated}) used by /admin/mint (status in_custody only) and
--           /admin/grading (pending_intake/in_custody only).
--    Write blockers on items: trg_items_condition_grade fires only on
--    float_value; payment_v2_fence refuses any non-owner write to an item in
--    payment_v2.inventory. An enrolled candidate is therefore refused HERE,
--    with its count, before the fence would raise a bare 42501.
--
--    Refuses (manual review first; nothing is silently relabelled) when a
--    candidate is in warehouse custody, is v2-enrolled, or was stamped by a
--    user who is not an admin.
--
-- 2. ACL. fn_approve_submission carried EXECUTE for PUBLIC (=X/postgres), so
--    anon reached it (fn_require_admin() refused inside). EXECUTE is revoked
--    from PUBLIC and anon; postgres, authenticated and service_role keep it.
--    The body is untouched. The other PUBLIC/anon-executable fn_* are reported
--    in docs/handoff/payment-security.md (080), not changed here.
--
-- 3. fn_confirm_shipment (077 body) refused only status 'shipped'. A
--    'defaulted' redemption (fn_mark_default) could be confirmed by its
--    fulfiller, flipping it to 'shipped', the item to 'shipped', and adding a
--    fulfilments_completed. Redemptions are only ever created as 'requested'
--    (warehouse, fulfiller_id NULL) or 'awaiting_seller' (seller-held,
--    fulfiller set) (013/026/048), and leave by 'shipped' or 'defaulted'. It
--    now requires exactly that source state for its custody, with neither
--    shipped_at nor defaulted_at set ('redemption % is %, expected %' ->
--    WRONG_STATUS). The check sits after the holder check, so a non-holder
--    still gets 'only the holder ...' and learns nothing new.
--
-- Function repairs are self-relative (as 074/078/079): an exact single-line
-- fragment substitution (CR-tolerant: fragments never span a line end, body
-- pins are CR-stripped); owner, ACL, SECURITY DEFINER, search_path and all
-- other pg_proc metadata must be identical before and after.
-- ============================================================================

BEGIN;

-- Writers wait until COMMIT; readers do not.
LOCK TABLE public.items IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE m080_before ON COMMIT DROP AS
 SELECT fn.oid, fn.oid::regprocedure::text AS sig, fn.proowner, fn.proacl, fn.prosecdef, fn.proconfig, fn.provolatile,
  fn.proisstrict, fn.proparallel, fn.proleakproof, pg_get_function_identity_arguments(fn.oid) AS identity_args,
  pg_get_function_result(fn.oid) AS result_type, to_jsonb(fn)-'prosrc'-'proacl' AS metadata, fn.prosrc, f.frag_old, f.frag_new, f.ord
 FROM (VALUES
  (1,'public.fn_confirm_shipment(uuid,text,text)',
   $f$  if coalesce(p_carrier,'') = '' or coalesce(p_tracking,'') = '' then$f$,
   $f$  if v_red.status is distinct from (case when v_red.fulfiller_id is null then 'requested' else 'awaiting_seller' end) or v_red.shipped_at is not null or v_red.defaulted_at is not null then raise exception 'redemption % is %, expected %', p_redemption_id, v_red.status, case when v_red.fulfiller_id is null then 'requested' else 'awaiting_seller' end; end if; if coalesce(p_carrier,'') = '' or coalesce(p_tracking,'') = '' then$f$),
  -- ACL only: no fragment; the body must come out byte-identical.
  (0,'public.fn_approve_submission(uuid,integer,integer)',NULL,NULL)
 ) f(ord,sig,frag_old,frag_new)
 JOIN pg_proc fn ON fn.oid=f.sig::regprocedure;

-- The step-1 predicate, evaluated once into a snapshot.
CREATE TEMP TABLE m080_items ON COMMIT DROP AS
 SELECT i.id, to_jsonb(i) AS row_before, i.custody::text AS custody, i.authenticated_at, i.authenticated_by,
  EXISTS(SELECT 1 FROM payment_v2.inventory v WHERE v.item_id=i.id) AS enrolled,
  (i.authenticated_by IS NULL OR EXISTS(SELECT 1 FROM public.users u WHERE u.id=i.authenticated_by AND u.is_admin)) AS by_admin_or_null
 FROM public.items i
 WHERE i.custody<>'warehouse' AND i.authenticated_at IS NOT NULL AND i.review_approved_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM payment_v2.sales s JOIN payment_v2.escrows x ON x.sale_id=s.id
   JOIN payment_v2.decisions d ON d.escrow_id=x.id JOIN payment_v2.attestations a ON a.decision_id=d.id
   WHERE s.item_id=i.id AND d.action IN('authentication_pass','review_authentication_pass'));

-- Every other item, to prove step 1 touches nothing else.
CREATE TEMP TABLE m080_others ON COMMIT DROP AS
 SELECT count(*) AS n, md5(coalesce(string_agg(to_jsonb(i)::text,E'\n' ORDER BY i.id),'')) AS h
 FROM public.items i WHERE i.id NOT IN(SELECT id FROM m080_items);

DO $preguard$
DECLARE r record;v_n bigint;
BEGIN
 IF (SELECT count(*) FROM m080_before)<>2 OR (SELECT count(DISTINCT oid) FROM m080_before)<>2 THEN
  RAISE EXCEPTION '080: snapshot captured % rows over % functions, expected 2 over 2',
   (SELECT count(*) FROM m080_before),(SELECT count(DISTINCT oid) FROM m080_before);
 END IF;
 FOR r IN SELECT oid,sig FROM m080_before LOOP
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=r.oid) AND proname=(SELECT proname FROM pg_proc WHERE oid=r.oid);
  IF v_n<>1 THEN RAISE EXCEPTION '080: expected exactly one % overload, found %',r.sig,v_n;END IF;
 END LOOP;
 FOR r IN SELECT * FROM m080_before WHERE ord>0 LOOP
  IF position(E'\n' IN r.frag_old||r.frag_new)>0 OR position(E'\r' IN r.frag_old||r.frag_new)>0 THEN RAISE EXCEPTION '080: fragments must be single-line';END IF;
  IF position(r.frag_new IN r.prosrc)>0 THEN RAISE EXCEPTION '080: % already carries the 080 fragment %',r.sig,r.ord;END IF;
  IF (length(r.prosrc)-length(replace(r.prosrc,r.frag_old,'')))/length(r.frag_old)<>1 THEN
   RAISE EXCEPTION '080: fragment % of % must occur exactly once in prosrc (found %); inspect catalog before repair',
    r.ord,r.sig,(length(r.prosrc)-length(replace(r.prosrc,r.frag_old,'')))/length(r.frag_old);
  END IF;
 END LOOP;
 -- App functions as 034 left them: definer, search_path=public, one common owner that is not the v2 owner.
 IF EXISTS(SELECT 1 FROM m080_before WHERE NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=public'])
  OR (SELECT count(DISTINCT proowner) FROM m080_before)<>1
  OR EXISTS(SELECT 1 FROM m080_before WHERE proowner='payment_v2_owner'::regrole) THEN
  RAISE EXCEPTION '080: owner/definer/search_path state is not the expected app-function state';
 END IF;
 -- Bodies pinned CR-stripped: fn_confirm_shipment is 077's (production V6), fn_approve_submission is 079's (Q1).
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM m080_before WHERE ord=1)<>'a933c7a798b54219fefe3d571fe795d9' THEN
  RAISE EXCEPTION '080: fn_confirm_shipment is not the 077 body (found md5 %)',(SELECT md5(replace(prosrc,chr(13),'')) FROM m080_before WHERE ord=1);
 END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM m080_before WHERE ord=0)<>'947e0f9b1dbb35169065bcc64637d699' THEN
  RAISE EXCEPTION '080: fn_approve_submission is not the 079 body (found md5 %); apply 079 first',(SELECT md5(replace(prosrc,chr(13),'')) FROM m080_before WHERE ord=0);
 END IF;
 -- 2: PUBLIC must still hold EXECUTE on fn_approve_submission (a re-run is refused here and by the fragment check).
 IF NOT EXISTS(SELECT 1 FROM m080_before b CROSS JOIN LATERAL aclexplode(coalesce(b.proacl,acldefault('f',b.proowner))) a
   WHERE b.ord=0 AND a.grantee=0::oid AND a.privilege_type='EXECUTE') THEN
  RAISE EXCEPTION '080: fn_approve_submission no longer grants EXECUTE to PUBLIC; 080 already applied or the ACL drifted';
 END IF;
 IF EXISTS(SELECT 1 FROM m080_before b CROSS JOIN LATERAL aclexplode(coalesce(b.proacl,acldefault('f',b.proowner))) a
   WHERE b.ord=0 AND a.grantee NOT IN(0::oid,b.proowner,'authenticated'::regrole::oid,'service_role'::regrole::oid,'anon'::regrole::oid)) THEN
  RAISE EXCEPTION '080: fn_approve_submission ACL has an unexpected grantee: %',(SELECT proacl FROM m080_before WHERE ord=0);
 END IF;
 IF NOT has_function_privilege('authenticated','public.fn_approve_submission(uuid,integer,integer)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.fn_approve_submission(uuid,integer,integer)','EXECUTE') THEN
  RAISE EXCEPTION '080: authenticated/service_role cannot already execute fn_approve_submission';
 END IF;
 -- 1: the predicate's domain and columns.
 IF (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='public.custody_model'::regtype)
    IS DISTINCT FROM ARRAY['warehouse','seller'] THEN
  RAISE EXCEPTION '080: custody_model is not {warehouse, seller}';
 END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.items'::regclass AND NOT attisdropped
     AND attname IN('authenticated_at','authenticated_by','review_approved_at','review_approved_by'))<>4 THEN
  RAISE EXCEPTION '080: items.authenticated_* / review_approved_* are not all present; apply 079 first';
 END IF;
 IF EXISTS(SELECT 1 FROM m080_items WHERE custody='warehouse') THEN
  RAISE EXCEPTION '080: % candidate item(s) are in warehouse custody; refusing', (SELECT count(*) FROM m080_items WHERE custody='warehouse');
 END IF;
 IF EXISTS(SELECT 1 FROM m080_items WHERE enrolled) THEN
  RAISE EXCEPTION '080: % candidate item(s) are enrolled in payment_v2.inventory; review before applying',(SELECT count(*) FROM m080_items WHERE enrolled);
 END IF;
 IF EXISTS(SELECT 1 FROM m080_items WHERE NOT by_admin_or_null) THEN
  RAISE EXCEPTION '080: % candidate item(s) were stamped by a non-admin user; review before applying',(SELECT count(*) FROM m080_items WHERE NOT by_admin_or_null);
 END IF;
END $preguard$;

-- 1. DATA
DO $data$
DECLARE v_n bigint;
BEGIN
 UPDATE public.items i SET review_approved_at=m.authenticated_at, review_approved_by=m.authenticated_by,
  authenticated_at=NULL, authenticated_by=NULL
 FROM m080_items m WHERE i.id=m.id;
 GET DIAGNOSTICS v_n = ROW_COUNT;
 IF v_n<>(SELECT count(*) FROM m080_items) THEN RAISE EXCEPTION '080: updated % item(s), snapshot has %',v_n,(SELECT count(*) FROM m080_items);END IF;
 RAISE NOTICE '080: moved % seller-review stamp(s) from authenticated_at/by to review_approved_at/by',v_n;
END $data$;

-- 2. ACL
REVOKE EXECUTE ON FUNCTION public.fn_approve_submission(uuid,integer,integer) FROM PUBLIC, anon;

-- 3. fn_confirm_shipment
DO $repair$
DECLARE r record;v_def text;
BEGIN
 FOR r IN SELECT oid,sig,frag_old,frag_new FROM m080_before WHERE ord>0 LOOP
  SELECT pg_get_functiondef(r.oid) INTO v_def;
  IF (length(v_def)-length(replace(v_def,r.frag_old,'')))/length(r.frag_old)<>1 THEN
   RAISE EXCEPTION '080: fragment not found exactly once in pg_get_functiondef(%)',r.sig;
  END IF;
  EXECUTE replace(v_def,r.frag_old,r.frag_new);
 END LOOP;
END $repair$;

DO $postguard$
DECLARE r record;v_n bigint;
BEGIN
 -- Functions: everything but the permitted change is identical.
 FOR r IN SELECT * FROM m080_before LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc live WHERE live.oid=r.oid AND live.oid=r.sig::regprocedure
    AND live.proowner=r.proowner AND live.prosecdef=r.prosecdef
    AND live.proconfig IS NOT DISTINCT FROM r.proconfig AND live.provolatile=r.provolatile AND live.proisstrict=r.proisstrict
    AND live.proparallel=r.proparallel AND live.proleakproof=r.proleakproof
    AND pg_get_function_identity_arguments(live.oid)=r.identity_args AND pg_get_function_result(live.oid)=r.result_type
    AND (to_jsonb(live)-'prosrc'-'proacl') IS NOT DISTINCT FROM r.metadata
    AND live.prosrc=CASE WHEN r.ord>0 THEN replace(r.prosrc,r.frag_old,r.frag_new) ELSE r.prosrc END
    AND (r.ord=0 OR live.proacl IS NOT DISTINCT FROM r.proacl)) THEN
   RAISE EXCEPTION '080: % changed beyond its permitted change; rolling back',r.sig;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=r.oid) AND proname=(SELECT proname FROM pg_proc WHERE oid=r.oid);
  IF v_n<>1 THEN RAISE EXCEPTION '080: overload count for % is % after repair',r.sig,v_n;END IF;
 END LOOP;
 -- fn_approve_submission ACL: the old entries minus PUBLIC and anon, and that is exactly owner + authenticated + service_role, EXECUTE only.
 IF EXISTS(
   (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM m080_before b CROSS JOIN LATERAL aclexplode(coalesce(b.proacl,acldefault('f',b.proowner))) a
     WHERE b.ord=0 AND a.grantee NOT IN(0::oid,'anon'::regrole::oid))
   EXCEPT
   (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
     WHERE p.oid='public.fn_approve_submission(uuid,integer,integer)'::regprocedure))
  OR EXISTS(
   (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
     WHERE p.oid='public.fn_approve_submission(uuid,integer,integer)'::regprocedure)
   EXCEPT
   (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM m080_before b CROSS JOIN LATERAL aclexplode(coalesce(b.proacl,acldefault('f',b.proowner))) a
     WHERE b.ord=0 AND a.grantee NOT IN(0::oid,'anon'::regrole::oid)))
  OR (SELECT array_agg(a.grantee::regrole::text||':'||a.privilege_type||':'||a.is_grantable ORDER BY a.grantee::regrole::text)
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.fn_approve_submission(uuid,integer,integer)'::regprocedure)
     IS DISTINCT FROM ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false'] THEN
  RAISE EXCEPTION '080: fn_approve_submission ACL is not exactly {postgres, authenticated, service_role}: %',
   (SELECT proacl FROM pg_proc WHERE oid='public.fn_approve_submission(uuid,integer,integer)'::regprocedure);
 END IF;
 IF has_function_privilege('anon','public.fn_approve_submission(uuid,integer,integer)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.fn_approve_submission(uuid,integer,integer)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.fn_approve_submission(uuid,integer,integer)','EXECUTE') THEN
  RAISE EXCEPTION '080: effective EXECUTE on fn_approve_submission is not anon=false authenticated=true service_role=true';
 END IF;
 -- Data: nothing matches the predicate any more ...
 SELECT count(*) INTO v_n FROM public.items i
  WHERE i.custody<>'warehouse' AND i.authenticated_at IS NOT NULL AND i.review_approved_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM payment_v2.sales s JOIN payment_v2.escrows x ON x.sale_id=s.id
    JOIN payment_v2.decisions d ON d.escrow_id=x.id JOIN payment_v2.attestations a ON a.decision_id=d.id
    WHERE s.item_id=i.id AND d.action IN('authentication_pass','review_authentication_pass'));
 IF v_n<>0 THEN RAISE EXCEPTION '080: % item(s) still match the step-1 predicate',v_n;END IF;
 -- ... each moved row changed in exactly the four columns, values carried across ...
 IF EXISTS(SELECT 1 FROM m080_items m LEFT JOIN public.items i ON i.id=m.id
   WHERE i.id IS NULL OR i.custody::text<>'seller' OR i.authenticated_at IS NOT NULL OR i.authenticated_by IS NOT NULL
    OR i.review_approved_at IS DISTINCT FROM m.authenticated_at OR i.review_approved_by IS DISTINCT FROM m.authenticated_by
    OR (to_jsonb(i)-'authenticated_at'-'authenticated_by'-'review_approved_at'-'review_approved_by')
       IS DISTINCT FROM (m.row_before-'authenticated_at'-'authenticated_by'-'review_approved_at'-'review_approved_by')) THEN
  RAISE EXCEPTION '080: a moved item differs from its snapshot beyond the four stamp columns';
 END IF;
 -- ... and every other item is byte-identical.
 IF (SELECT ROW(count(*),md5(coalesce(string_agg(to_jsonb(i)::text,E'\n' ORDER BY i.id),''))) FROM public.items i WHERE i.id NOT IN(SELECT id FROM m080_items))
    IS DISTINCT FROM (SELECT ROW(n,h) FROM m080_others) THEN
  RAISE EXCEPTION '080: an item outside the step-1 snapshot changed';
 END IF;
 -- Remaining seller-held stamps are only ones backed by a review approval or an attested pass.
 RAISE NOTICE '080: seller-held items still carrying authenticated_at (review-approved or v2-attested, left as is): %',
  (SELECT count(*) FROM public.items WHERE custody<>'warehouse' AND authenticated_at IS NOT NULL);
END $postguard$;

COMMIT;
