-- 081 container test: fn_set_card_visibility EXECUTE, before and after 081. psql only, never npm.
-- Read-only in effect: synthetic fixtures and every probe are rolled back.
--   psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -v phase=before|after -f 84_card_visibility_acl.sql
\ir 00_target_guard.sql
\if :{?phase}
\else
\echo 'Refusing: pass -v phase=before or -v phase=after'
\quit 3
\endif
\set QUIET 1
BEGIN;
CREATE TEMP TABLE t084(name text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO t084 VALUES ('phase_' || :'phase', gen_random_uuid());
CREATE FUNCTION pg_temp.ok(p boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'T084 ASSERT FAILED: %', label; END IF; RETURN 'PASS ' || label; END $$;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t084 WHERE name = p $$;
-- Probe as p_role (with claims sub = p_sub), always undone. Ids are resolved by the caller before the role switch.
CREATE FUNCTION pg_temp.probe(p_card uuid, p_sub uuid, p_role text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM set_config('role', p_role, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  PERFORM public.fn_set_card_visibility(p_card, false);
  RAISE EXCEPTION 'T084_UNDO';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'T084_UNDO' THEN RETURN 'accepted'; END IF;
  RETURN 'refused ' || SQLSTATE || ' ' || regexp_replace(SQLERRM, '[0-9a-f]{8}-[0-9a-f-]{27}', '<id>', 'g');
 END;
END $$;
DO $fx$
DECLARE owner uuid := gen_random_uuid(); other uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
 m uuid := gen_random_uuid(); s uuid := gen_random_uuid(); i uuid := gen_random_uuid(); c uuid := gen_random_uuid();
BEGIN
 INSERT INTO public.users(id, auth_id, handle, email, country_code, is_admin) VALUES
  (owner, owner, 't84o' || left(replace(owner::text,'-',''),16), 't84-' || owner || '@example.invalid', 'MY', false),
  (other, other, 't84x' || left(replace(other::text,'-',''),16), 't84-' || other || '@example.invalid', 'MY', false),
  (admin, admin, 't84a' || left(replace(admin::text,'-',''),16), 't84-' || admin || '@example.invalid', 'MY', true);
 INSERT INTO public.sku_models(id, brand, model, colorway, base_price_cents) VALUES (m, 'Synthetic084', 'M-' || m, 'Test', 2000);
 INSERT INTO public.skus(id, model_id, brand, model, colorway, size_us) VALUES (s, m, 'Synthetic084', 'Derived', 'Test', 10);
 INSERT INTO public.items(id, sku_id, consignor_id, status, float_value, custody, grade_source, asking_price_cents)
 VALUES (i, s, owner, 'minted', 0.120, 'warehouse', 'flexsoar', 2500);
 INSERT INTO public.cards(id, item_id, sku_id, owner_id, float_value, tier, mint_number, status) VALUES (c, i, s, owner, 0.120, 1, 1, 'active');
 INSERT INTO t084 VALUES ('owner', owner), ('other', other), ('admin', admin), ('card', c), ('missing', gen_random_uuid());
END $fx$;
\unset QUIET
SELECT 'ACL|' || :'phase' || ' ' || proacl::text FROM pg_proc WHERE oid = 'public.fn_set_card_visibility(uuid,boolean)'::regprocedure;
SELECT 'PROBE|' || :'phase' || ' ' || v.label || ' -> ' || pg_temp.probe(v.card, v.sub, v.role)
FROM (VALUES (1, 'anon, unknown card', pg_temp.id('missing'), NULL::uuid, 'anon'),
             (2, 'anon, existing card', pg_temp.id('card'), NULL::uuid, 'anon'),
             (3, 'authenticated owner', pg_temp.id('card'), pg_temp.id('owner'), 'authenticated'),
             (4, 'authenticated other user', pg_temp.id('card'), pg_temp.id('other'), 'authenticated'),
             (5, 'authenticated admin', pg_temp.id('card'), pg_temp.id('admin'), 'authenticated')) v(o, label, card, sub, role)
ORDER BY v.o;
-- Unchanged in both phases.
SELECT pg_temp.ok(pg_temp.probe(pg_temp.id('card'), pg_temp.id('owner'), 'authenticated') = 'accepted', 'owner may toggle');
SELECT pg_temp.ok(pg_temp.probe(pg_temp.id('card'), pg_temp.id('admin'), 'authenticated') = 'accepted', 'admin may toggle');
SELECT pg_temp.ok(pg_temp.probe(pg_temp.id('card'), pg_temp.id('other'), 'authenticated') = 'refused P0001 not your card', 'another user is refused inside');
SELECT pg_temp.ok(md5(replace(prosrc, chr(13), '')) = '48282c3898dfddb172b45b6fcf4f1f7c' AND prosecdef AND proconfig = ARRAY['search_path=public']
  AND pg_get_userbyid(proowner) = 'postgres', 'body/owner/definer/search_path unchanged')
FROM pg_proc WHERE oid = 'public.fn_set_card_visibility(uuid,boolean)'::regprocedure;
-- Phase-specific.
SELECT CASE :'phase'
 WHEN 'before' THEN pg_temp.ok(
   (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_set_card_visibility(uuid,boolean)'::regprocedure)
     = '{=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
   AND has_function_privilege('anon', 'public.fn_set_card_visibility(uuid,boolean)', 'EXECUTE')
   AND pg_temp.probe(pg_temp.id('missing'), NULL, 'anon') = 'refused P0001 card <id> not found'
   AND pg_temp.probe(pg_temp.id('card'), NULL, 'anon') = 'refused P0001 not your card',
   'before: PUBLIC holds EXECUTE; anon reaches the body and can tell an existing card from a missing one')
 WHEN 'after' THEN pg_temp.ok(
   (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_set_card_visibility(uuid,boolean)'::regprocedure)
     = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
   AND NOT has_function_privilege('anon', 'public.fn_set_card_visibility(uuid,boolean)', 'EXECUTE')
   AND has_function_privilege('authenticated', 'public.fn_set_card_visibility(uuid,boolean)', 'EXECUTE')
   AND has_function_privilege('service_role', 'public.fn_set_card_visibility(uuid,boolean)', 'EXECUTE')
   AND pg_temp.probe(pg_temp.id('missing'), NULL, 'anon') = 'refused 42501 permission denied for function fn_set_card_visibility'
   AND pg_temp.probe(pg_temp.id('card'), NULL, 'anon') = 'refused 42501 permission denied for function fn_set_card_visibility',
   'after: ACL exact; anon refused before the body for any card id')
 ELSE pg_temp.ok(false, 'phase must be before or after') END;
ROLLBACK;
\echo T084_OK
