-- ============================================================================
-- 069c_payment_v2_actor_current_user_id.sql
--
-- payment_v2.actor() (060:28) is SECURITY DEFINER, owned by payment_v2_owner,
-- and read `auth.uid()` directly. On Supabase the migration role (`postgres`)
-- holds USAGE on schema auth WITHOUT grant option (auth ACL
-- postgres=U/supabase_admin), so 059:37's GRANT USAGE ON SCHEMA auth TO
-- payment_v2_owner is a no-op ("no privileges were granted for auth") and
-- every caller-resolving v2 RPC failed closed with
--   42501 permission denied for schema auth   (staging, 2026-10-21).
--
-- Fix (founder decision 2026-10-21): actor() resolves the caller through
-- public.fn_current_user_id() -- SECURITY DEFINER, owned by postgres, body
-- `select id from users where auth_id = auth.uid();` (004:25) -- and
-- payment_v2_owner gets EXECUTE on it. Identity semantics are unchanged:
-- the old body ran the identical query (`SELECT id ... WHERE auth_id=auth.uid()`),
-- so actor() still returns users.id, never the auth id, and a session with no
-- users row still yields NULL -> PAYMENT_V2_SIGN_IN (42501), as 077 does.
-- users.id = auth_id for every row with an auth_id is enforced by 004's
-- users_id_matches_auth trigger; the preguard asserts the trigger and the data.
--
-- Self-relative (as 074/078): the only permitted change to actor() is the
-- single fragment substitution below; owner, ACL, SECURITY DEFINER,
-- search_path and all other metadata must be identical before and after.
-- Requires 060 applied. Independent of 070-078 (none of them touches actor()).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE m069c_before ON COMMIT DROP AS
 SELECT fn.oid, fn.proowner, fn.proacl, fn.prosecdef, fn.proconfig, fn.provolatile, fn.proisstrict,
  fn.proparallel, fn.proleakproof, pg_get_function_identity_arguments(fn.oid) AS identity_args,
  pg_get_function_result(fn.oid) AS result_type, to_jsonb(fn)-'prosrc' AS metadata, fn.prosrc,
  'SELECT id INTO v FROM public.users WHERE auth_id=auth.uid();'::text AS frag_old,
  'v:=public.fn_current_user_id();'::text AS frag_new
 FROM pg_proc fn WHERE fn.oid = 'payment_v2.actor()'::regprocedure;

DO $preguard$
DECLARE v_n bigint; b m069c_before%rowtype; v_def text;
BEGIN
 SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'payment_v2'::regnamespace AND proname = 'actor';
 IF v_n <> 1 THEN RAISE EXCEPTION '069c: expected exactly one payment_v2.actor overload, found %', v_n; END IF;
 SELECT * INTO b FROM m069c_before;
 IF b.proowner <> 'payment_v2_owner'::regrole OR NOT b.prosecdef
  OR b.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] OR b.result_type <> 'uuid' THEN
  RAISE EXCEPTION '069c: payment_v2.actor() owner/definer/search_path/result not as 060 created it; inspect catalog';
 END IF;
 IF (length(b.prosrc) - length(replace(b.prosrc, b.frag_old, ''))) / length(b.frag_old) <> 1 THEN
  RAISE EXCEPTION '069c: actor() does not contain the 060 auth.uid() fragment exactly once; inspect catalog';
 END IF;
 IF position('auth.' IN replace(b.prosrc, b.frag_old, '')) > 0 THEN
  RAISE EXCEPTION '069c: actor() references auth.* outside the fragment being replaced';
 END IF;
 v_def := pg_get_functiondef(b.oid);
 IF (length(v_def) - length(replace(v_def, b.frag_old, ''))) / length(b.frag_old) <> 1 THEN
  RAISE EXCEPTION '069c: function definition does not contain the fragment exactly once';
 END IF;

 -- The resolver actor() will delegate to: one overload, definer, owned by postgres, the 004 body.
 SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_current_user_id';
 IF v_n <> 1 THEN RAISE EXCEPTION '069c: expected exactly one public.fn_current_user_id overload, found %', v_n; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.fn_current_user_id()'::regprocedure
   AND p.prosecdef AND p.proowner = 'postgres'::regrole AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']
   AND pg_get_function_result(p.oid) = 'uuid' AND md5(replace(p.prosrc, chr(13), '')) = '58bf7a571ed18517cf69aee36bc2c46a') THEN
  RAISE EXCEPTION '069c: public.fn_current_user_id() is not the 004 definer body owned by postgres; inspect catalog';
 END IF;

 -- users.id = auth_id invariant: enforced by trigger, and holds in the data.
 IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.users'::regclass AND t.tgname = 'users_id_matches_auth' AND t.tgenabled = 'O'
     AND NOT t.tgisinternal AND p.oid = 'public.trg_users_id_matches_auth()'::regprocedure
     AND md5(replace(p.prosrc, chr(13), '')) = '4893a65af8ace35617aaa247b851af2d') THEN
  RAISE EXCEPTION '069c: users_id_matches_auth trigger missing, disabled or not the 004 body';
 END IF;
 SELECT count(*) INTO v_n FROM public.users WHERE auth_id IS NOT NULL AND id <> auth_id;
 IF v_n <> 0 THEN RAISE EXCEPTION '069c: % users rows have id <> auth_id; refusing', v_n; END IF;
END $preguard$;

GRANT EXECUTE ON FUNCTION public.fn_current_user_id() TO payment_v2_owner;

DO $repair$
DECLARE b m069c_before%rowtype;
BEGIN
 SELECT * INTO b FROM m069c_before;
 EXECUTE replace(pg_get_functiondef(b.oid), b.frag_old, b.frag_new);
END $repair$;

DO $postguard$
DECLARE b m069c_before%rowtype; v_n bigint;
BEGIN
 SELECT * INTO b FROM m069c_before;
 IF NOT EXISTS (SELECT 1 FROM pg_proc live WHERE live.oid = b.oid AND live.oid = 'payment_v2.actor()'::regprocedure
   AND live.proowner = b.proowner AND live.proacl IS NOT DISTINCT FROM b.proacl AND live.prosecdef = b.prosecdef
   AND live.proconfig IS NOT DISTINCT FROM b.proconfig AND live.provolatile = b.provolatile AND live.proisstrict = b.proisstrict
   AND live.proparallel = b.proparallel AND live.proleakproof = b.proleakproof
   AND pg_get_function_identity_arguments(live.oid) = b.identity_args AND pg_get_function_result(live.oid) = b.result_type
   AND (to_jsonb(live)-'prosrc') IS NOT DISTINCT FROM b.metadata
   AND live.prosrc = replace(b.prosrc, b.frag_old, b.frag_new)) THEN
  RAISE EXCEPTION '069c: payment_v2.actor() changed beyond its permitted fragment substitution; rolling back';
 END IF;
 IF position('auth.' IN (SELECT prosrc FROM pg_proc WHERE oid = b.oid)) > 0 THEN
  RAISE EXCEPTION '069c: actor() still references auth.*';
 END IF;
 SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'payment_v2'::regnamespace AND proname = 'actor';
 IF v_n <> 1 THEN RAISE EXCEPTION '069c: overload count for payment_v2.actor is % after repair', v_n; END IF;
 IF NOT has_function_privilege('payment_v2_owner', 'public.fn_current_user_id()', 'EXECUTE') THEN
  RAISE EXCEPTION '069c: payment_v2_owner cannot execute public.fn_current_user_id()';
 END IF;
 IF has_function_privilege('anon', 'payment_v2.actor()', 'EXECUTE')
  OR has_function_privilege('authenticated', 'payment_v2.actor()', 'EXECUTE')
  OR has_schema_privilege('anon', 'payment_v2', 'USAGE') OR has_schema_privilege('authenticated', 'payment_v2', 'USAGE') THEN
  RAISE EXCEPTION '069c: anon/authenticated can reach payment_v2.actor()';
 END IF;
END $postguard$;

COMMIT;
