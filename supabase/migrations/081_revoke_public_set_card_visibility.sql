-- ============================================================================
-- 081_revoke_public_set_card_visibility.sql
--
-- Requires 080 applied. One transaction; no data change; no body change; no
-- arity change.
--
-- fn_set_card_visibility(uuid,boolean) (046) carried EXECUTE for PUBLIC
-- (=X/postgres), so anon reached it. Its owner-or-admin check refused anon
-- inside the function (owner_id is NOT NULL, so it is distinct from a NULL
-- caller), but it still answered "card % not found" vs "not your card", which
-- tells an anonymous caller whether a card id exists. The only app caller is
-- toggleCardVisibilityAction (app/(market)/actions.ts), which requires a
-- signed-in session before calling. EXECUTE is revoked from PUBLIC and anon;
-- postgres (owner), authenticated and service_role keep it.
--
-- Production's ACL before 081, from the 080 preflight R1 line:
--   {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- Self-relative as 080's ACL step:
--   - the body is pinned CR-stripped and must come out byte-identical;
--   - owner, SECURITY DEFINER, search_path and every other pg_proc field
--     except proacl must be unchanged;
--   - the ACL after must equal the ACL before minus PUBLIC/anon, and be
--     exactly {postgres, authenticated, service_role} EXECUTE without grant
--     option;
--   - a re-run is refused (PUBLIC no longer holds EXECUTE).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE m081_before ON COMMIT DROP AS
 SELECT fn.oid, fn.oid::regprocedure::text AS sig, fn.proowner, fn.proacl, fn.prosecdef, fn.proconfig, fn.prosrc,
  pg_get_function_identity_arguments(fn.oid) AS identity_args, pg_get_function_result(fn.oid) AS result_type,
  to_jsonb(fn)-'prosrc'-'proacl' AS metadata
 FROM pg_proc fn WHERE fn.oid='public.fn_set_card_visibility(uuid,boolean)'::regprocedure;

DO $preguard$
DECLARE v_n bigint;
BEGIN
 IF (SELECT count(*) FROM m081_before)<>1 THEN RAISE EXCEPTION '081: fn_set_card_visibility(uuid,boolean) not found';END IF;
 SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_set_card_visibility';
 IF v_n<>1 THEN RAISE EXCEPTION '081: expected exactly one fn_set_card_visibility overload, found %',v_n;END IF;
 -- 080 first: its fn_confirm_shipment body is in place.
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.fn_confirm_shipment(uuid,text,text)'::regprocedure)
    <>'4f1b8f8396b0656d275a545c55447d50' THEN
  RAISE EXCEPTION '081: 080 is not applied (fn_confirm_shipment is not the 080 body)';
 END IF;
 -- The 046 body, CR-stripped.
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM m081_before)<>'48282c3898dfddb172b45b6fcf4f1f7c' THEN
  RAISE EXCEPTION '081: fn_set_card_visibility is not the 046 body (found md5 %)',(SELECT md5(replace(prosrc,chr(13),'')) FROM m081_before);
 END IF;
 -- App-function state as 034 left it: definer, search_path=public, not the v2 owner.
 IF EXISTS(SELECT 1 FROM m081_before WHERE NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=public'] OR proowner='payment_v2_owner'::regrole) THEN
  RAISE EXCEPTION '081: owner/definer/search_path state is not the expected app-function state';
 END IF;
 -- PUBLIC must still hold EXECUTE (a re-run is refused here).
 IF NOT EXISTS(SELECT 1 FROM m081_before b CROSS JOIN LATERAL aclexplode(coalesce(b.proacl,acldefault('f',b.proowner))) a
   WHERE a.grantee=0::oid AND a.privilege_type='EXECUTE') THEN
  RAISE EXCEPTION '081: fn_set_card_visibility no longer grants EXECUTE to PUBLIC; 081 already applied or the ACL drifted';
 END IF;
 IF EXISTS(SELECT 1 FROM m081_before b CROSS JOIN LATERAL aclexplode(coalesce(b.proacl,acldefault('f',b.proowner))) a
   WHERE a.grantee NOT IN(0::oid,b.proowner,'authenticated'::regrole::oid,'service_role'::regrole::oid,'anon'::regrole::oid)) THEN
  RAISE EXCEPTION '081: fn_set_card_visibility ACL has an unexpected grantee: %',(SELECT proacl FROM m081_before);
 END IF;
 IF NOT has_function_privilege('authenticated','public.fn_set_card_visibility(uuid,boolean)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.fn_set_card_visibility(uuid,boolean)','EXECUTE') THEN
  RAISE EXCEPTION '081: authenticated/service_role cannot already execute fn_set_card_visibility';
 END IF;
END $preguard$;

REVOKE EXECUTE ON FUNCTION public.fn_set_card_visibility(uuid,boolean) FROM PUBLIC, anon;

DO $postguard$
DECLARE r m081_before%rowtype;
BEGIN
 SELECT * INTO r FROM m081_before;
 IF NOT EXISTS(SELECT 1 FROM pg_proc live WHERE live.oid=r.oid AND live.oid='public.fn_set_card_visibility(uuid,boolean)'::regprocedure
   AND live.proowner=r.proowner AND live.prosecdef=r.prosecdef AND live.proconfig IS NOT DISTINCT FROM r.proconfig
   AND pg_get_function_identity_arguments(live.oid)=r.identity_args AND pg_get_function_result(live.oid)=r.result_type
   AND (to_jsonb(live)-'prosrc'-'proacl') IS NOT DISTINCT FROM r.metadata AND live.prosrc=r.prosrc) THEN
  RAISE EXCEPTION '081: fn_set_card_visibility changed beyond its ACL; rolling back';
 END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_set_card_visibility')<>1 THEN
  RAISE EXCEPTION '081: overload count changed';
 END IF;
 IF EXISTS(
   (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a
     WHERE a.grantee NOT IN(0::oid,'anon'::regrole::oid))
   EXCEPT
   (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
     WHERE p.oid='public.fn_set_card_visibility(uuid,boolean)'::regprocedure))
  OR EXISTS(
   (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
     WHERE p.oid='public.fn_set_card_visibility(uuid,boolean)'::regprocedure)
   EXCEPT
   (SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a
     WHERE a.grantee NOT IN(0::oid,'anon'::regrole::oid)))
  OR (SELECT array_agg(a.grantee::regrole::text||':'||a.privilege_type||':'||a.is_grantable ORDER BY a.grantee::regrole::text)
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.fn_set_card_visibility(uuid,boolean)'::regprocedure)
     IS DISTINCT FROM ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false'] THEN
  RAISE EXCEPTION '081: fn_set_card_visibility ACL is not exactly {postgres, authenticated, service_role}: %',
   (SELECT proacl FROM pg_proc WHERE oid='public.fn_set_card_visibility(uuid,boolean)'::regprocedure);
 END IF;
 IF has_function_privilege('anon','public.fn_set_card_visibility(uuid,boolean)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.fn_set_card_visibility(uuid,boolean)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.fn_set_card_visibility(uuid,boolean)','EXECUTE') THEN
  RAISE EXCEPTION '081: effective EXECUTE on fn_set_card_visibility is not anon=false authenticated=true service_role=true';
 END IF;
END $postguard$;

COMMIT;
