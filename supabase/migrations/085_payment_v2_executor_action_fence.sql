-- 085: keep issuer operations out of every executor-visible operation RPC.
-- Executor routes audited from 063 grants: claim, finish, context, signed-operation,
-- and stage-signed-operation. worker_identity reports only the caller identity;
-- notifier and issuer RPCs have separate principals. No issuer-only operation is
-- exposed by this migration.
BEGIN;

CREATE TEMP TABLE m085_before ON COMMIT DROP AS
 SELECT p.oid,p.oid::regprocedure::text AS sig,md5(replace(p.prosrc,chr(13),'')) AS body,
        p.proowner,p.proacl,p.prosecdef,p.proconfig
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='payment_v2' OR (n.nspname='public' AND p.proname LIKE 'fn\_payment\_v2\_%');
CREATE TEMP TABLE m085_expected(oid oid PRIMARY KEY,body text NOT NULL) ON COMMIT DROP;

DO $pre$
BEGIN
 IF NOT pg_has_role(current_user,'payment_v2_owner','SET') OR NOT pg_has_role(current_user,'payment_v2_owner','USAGE') THEN
  RAISE EXCEPTION '085: migration role cannot SET ROLE / inherit payment_v2_owner';
 END IF;
 IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION '085: funding must remain disabled';END IF;
 IF (SELECT count(*) FROM pg_proc WHERE oid IN (
  'public.fn_payment_v2_claim_operations(uuid,integer)'::regprocedure,
  'public.fn_payment_v2_finish_operation(uuid,uuid,text,text,text)'::regprocedure,
  'public.fn_payment_v2_operation_context(uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_signed_operation(uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_stage_signed_operation(uuid,uuid,jsonb)'::regprocedure))<>5 THEN
  RAISE EXCEPTION '085: executor RPC inventory differs from audited 063 routes';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN (
  'public.fn_payment_v2_claim_operations(uuid,integer)'::regprocedure,
  'public.fn_payment_v2_finish_operation(uuid,uuid,text,text,text)'::regprocedure,
  'public.fn_payment_v2_operation_context(uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_signed_operation(uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_stage_signed_operation(uuid,uuid,jsonb)'::regprocedure)
  AND (p.proowner<>'payment_v2_owner'::regrole OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
   OR NOT has_function_privilege('payment_v2_executor',p.oid,'EXECUTE')
   OR has_function_privilege('payment_v2_issuer',p.oid,'EXECUTE') IS DISTINCT FROM false
   OR (SELECT count(*) FROM aclexplode(p.proacl))<>2
   OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee NOT IN('payment_v2_owner'::regrole,'payment_v2_executor'::regrole)
     OR a.privilege_type<>'EXECUTE' OR a.is_grantable))) THEN
  RAISE EXCEPTION '085: executor function owner, ACL, or security settings drifted';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn_payment_v2_%'
  AND has_function_privilege('payment_v2_executor',p.oid,'EXECUTE')
  AND p.proname IN('fn_payment_v2_open_sale_queue','fn_payment_v2_enroll_wallet','fn_payment_v2_listing_for_open')) THEN
  RAISE EXCEPTION '085: executor unexpectedly has issuer-only RPC access';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN (
  'public.fn_payment_v2_claim_operations(uuid,integer)'::regprocedure,
  'public.fn_payment_v2_finish_operation(uuid,uuid,text,text,text)'::regprocedure,
  'public.fn_payment_v2_operation_context(uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_signed_operation(uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_stage_signed_operation(uuid,uuid,jsonb)'::regprocedure)
  AND md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM CASE p.proname
   WHEN 'fn_payment_v2_claim_operations' THEN 'd20b5c54637b07d0a7ee215a82ee5b12'
   WHEN 'fn_payment_v2_finish_operation' THEN '2ae6463a08df57d9a7e716dcb3b3657a'
   WHEN 'fn_payment_v2_operation_context' THEN 'd474cca860a04d01656c3cad34218880'
   WHEN 'fn_payment_v2_signed_operation' THEN '88ff451a9dd4bb3cb3f69c4250945d9f'
   WHEN 'fn_payment_v2_stage_signed_operation' THEN '315aa3991db6854342803f9bb01c630c' END) THEN
  RAISE EXCEPTION '085: pinned executor function body changed; review before substitution';
 END IF;
END $pre$;

-- Each substitution is pinned to the complete known body hash above and to an exact
-- fragment occurring once. pg_get_functiondef preserves signature, owner, ACL,
-- SECURITY DEFINER and search_path; the postguard proves those remained unchanged.
DO $replace$
DECLARE r record;src text;ddl text;old_fragment text;new_fragment text;new_src text;n integer;
BEGIN
 FOR r IN SELECT p.oid,p.oid::regprocedure::text sig,p.prosrc
  FROM pg_proc p WHERE p.oid IN (
   'public.fn_payment_v2_claim_operations(uuid,integer)'::regprocedure,
   'public.fn_payment_v2_finish_operation(uuid,uuid,text,text,text)'::regprocedure,
   'public.fn_payment_v2_operation_context(uuid,uuid)'::regprocedure,
   'public.fn_payment_v2_signed_operation(uuid,uuid)'::regprocedure,
   'public.fn_payment_v2_stage_signed_operation(uuid,uuid,jsonb)'::regprocedure)
 LOOP
  src:=replace(r.prosrc,chr(13),'');
  CASE r.sig
   WHEN 'fn_payment_v2_claim_operations(uuid,integer)' THEN
    old_fragment:='AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit';
    new_fragment:='AND op.action IN(''execute_outcome'',''acknowledge_claim'') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit';
   WHEN 'fn_payment_v2_finish_operation(uuid,uuid,text,text,text)' THEN
    old_fragment:='IF o.id IS NULL OR o.lease_id IS DISTINCT FROM p_lease_id OR o.leased_by<>session_user OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR o.state=''observed'' THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n IF p_outcome IS NULL';
    new_fragment:='IF o.id IS NULL OR o.lease_id IS DISTINCT FROM p_lease_id OR o.leased_by<>session_user OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR o.state=''observed'' THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n IF o.action NOT IN(''execute_outcome'',''acknowledge_claim'') THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n IF p_outcome IS NULL';
   WHEN 'fn_payment_v2_operation_context(uuid,uuid)' THEN
    old_fragment:='o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n SELECT id,listing_id';
    new_fragment:='o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n IF o.action NOT IN(''execute_outcome'',''acknowledge_claim'') THEN RAISE EXCEPTION ''PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN'' USING ERRCODE=''42501'';END IF;'||E'\n SELECT id,listing_id';
   WHEN 'fn_payment_v2_signed_operation(uuid,uuid)' THEN
    old_fragment:='o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n SELECT envelope INTO stored';
    new_fragment:='o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n IF NOT EXISTS(SELECT 1 FROM payment_v2.operations WHERE id=p_operation_id AND action=''execute_outcome'') THEN RAISE EXCEPTION ''PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN'' USING ERRCODE=''42501'';END IF;'||E'\n SELECT envelope INTO stored';
   WHEN 'fn_payment_v2_stage_signed_operation(uuid,uuid,jsonb)' THEN
    old_fragment:='o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n plan:=payment_v2.exit_plan(p_operation_id);';
    new_fragment:='o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION ''PAYMENT_V2_OPERATION_LEASE_LOST'';END IF;'||E'\n IF NOT EXISTS(SELECT 1 FROM payment_v2.operations WHERE id=p_operation_id AND action=''execute_outcome'') THEN RAISE EXCEPTION ''PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN'' USING ERRCODE=''42501'';END IF;'||E'\n plan:=payment_v2.exit_plan(p_operation_id);';
  END CASE;
  n:=(length(src)-length(replace(src,old_fragment,'')))/length(old_fragment);
  IF n<>1 THEN RAISE EXCEPTION '085: pinned fragment count for % is %, expected one',r.sig,n;END IF;
  new_src:=replace(src,old_fragment,new_fragment);
  INSERT INTO m085_expected VALUES(r.oid,md5(new_src));
  ddl:=replace(pg_get_functiondef(r.oid),chr(13),'');
  n:=(length(ddl)-length(replace(ddl,src,'')))/length(src);
  IF n<>1 THEN RAISE EXCEPTION '085: could not uniquely substitute function definition for %',r.sig;END IF;
  EXECUTE replace(ddl,src,new_src);
 END LOOP;
END $replace$;

DO $post$
BEGIN
 IF EXISTS(SELECT 1 FROM m085_before b JOIN pg_proc p ON p.oid=b.oid
  WHERE (b.oid IN(SELECT oid FROM m085_expected) AND md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM (SELECT e.body FROM m085_expected e WHERE e.oid=b.oid))
   OR (b.oid NOT IN(SELECT oid FROM m085_expected) AND md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM b.body)
   OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl
   OR p.prosecdef IS DISTINCT FROM b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig) THEN
  RAISE EXCEPTION '085: function body, owner, ACL, security-definer or search_path postguard failed';
 END IF;
 IF EXISTS(SELECT 1 FROM m085_before b WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=b.oid))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='payment_v2' OR (n.nspname='public' AND p.proname LIKE 'fn\_payment\_v2\_%')) AND p.oid NOT IN(SELECT oid FROM m085_before)) THEN
  RAISE EXCEPTION '085: payment function inventory changed';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[
  'public.fn_payment_v2_claim_operations(uuid,integer)'::regprocedure,
  'public.fn_payment_v2_finish_operation(uuid,uuid,text,text,text)'::regprocedure,
  'public.fn_payment_v2_operation_context(uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_signed_operation(uuid,uuid)'::regprocedure,
  'public.fn_payment_v2_stage_signed_operation(uuid,uuid,jsonb)'::regprocedure]) f(sig)
  WHERE has_function_privilege('payment_v2_executor',f.sig,'EXECUTE') IS DISTINCT FROM true
   OR has_function_privilege('anon',f.sig,'EXECUTE') OR has_function_privilege('authenticated',f.sig,'EXECUTE')
   OR has_function_privilege('service_role',f.sig,'EXECUTE')) THEN RAISE EXCEPTION '085: RPC ACL matrix changed';END IF;
END $post$;

COMMIT;
