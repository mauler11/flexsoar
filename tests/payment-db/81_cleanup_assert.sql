-- 080 (post-079 cleanup) container test, part 2 of 3: assertions AFTER 080 committed on an 80_cleanup_setup (scenario=main) database.
-- psql only, never npm. Read-only in effect: every behavioural probe runs in a subtransaction that is always undone, and the
-- file ends with ROLLBACK. Running it twice (before and after a refused 080 re-run) must print identical lines.
--   psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f 81_cleanup_assert.sql
\ir 00_target_guard.sql
\set QUIET 1
SET client_min_messages = notice;
BEGIN;
CREATE FUNCTION pg_temp.ok(p boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'T080 ASSERT FAILED: %', label; END IF; RETURN 'PASS ' || label; END $$;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t080.ids WHERE name = p $$;
CREATE FUNCTION pg_temp.probe(p_sql text, p_sub uuid, p_role text DEFAULT 'authenticated') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM set_config('role', p_role, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  EXECUTE p_sql;
  RAISE EXCEPTION 'T080_UNDO';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'T080_UNDO' THEN RETURN 'accepted'; END IF;
  RETURN 'refused ' || SQLSTATE || ' ' || regexp_replace(SQLERRM, '[0-9a-f]{8}-[0-9a-f-]{27}', '<id>', 'g');
 END;
END $$;
-- confirm_shipment probe that also reports what an accepted call did (inside the undone subtransaction).
CREATE FUNCTION pg_temp.ship(p_red text, p_who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_out text; v_red uuid := pg_temp.id(p_red); v_who uuid := pg_temp.id(p_who);
BEGIN
 BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
  PERFORM public.fn_confirm_shipment(v_red, 'SYN', 'SYN-1');
  PERFORM set_config('role', 'none', true);
  SELECT format('accepted status=%s item=%s', r.status, i.status) INTO v_out
   FROM public.redemptions r JOIN public.items i ON i.id = r.item_id WHERE r.id = v_red;
  RAISE EXCEPTION 'T080_UNDO';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'T080_UNDO' THEN RETURN v_out; END IF;
  RETURN 'refused ' || SQLSTATE || ' ' || regexp_replace(SQLERRM, '[0-9a-f]{8}-[0-9a-f-]{27}', '<id>', 'g');
 END;
END $$;
\unset QUIET

SELECT pg_temp.ok((SELECT v FROM t080.meta WHERE k = 'scenario') = 'main', 'fixtures are scenario=main');

-- 1. DATA ---------------------------------------------------------------------------------------------------------------
-- The two seller-review stamps moved: values carried across, the stamp cleared, nothing else on the row changed.
SELECT pg_temp.ok(
  i.authenticated_at IS NULL AND i.authenticated_by IS NULL
  AND i.review_approved_at = (b.row ->> 'authenticated_at')::timestamptz
  AND i.review_approved_by = (b.row ->> 'authenticated_by')::uuid
  AND i.review_approved_by = pg_temp.id('admin')
  AND i.custody = 'seller'
  AND (to_jsonb(i) - 'authenticated_at' - 'authenticated_by' - 'review_approved_at' - 'review_approved_by')
      = (b.row - 'authenticated_at' - 'authenticated_by' - 'review_approved_at' - 'review_approved_by'),
  'moved ' || t.name)
FROM t080.ids t JOIN public.items i ON i.id = t.id JOIN t080.items_before b ON b.id = i.id
WHERE t.name IN ('s1_review_stamp', 's4_review_stamp_unminted') ORDER BY t.name;
-- Every other item is byte-identical, including every warehouse item (w1 authenticated, w2 legacy review stamp, w3 none).
SELECT pg_temp.ok(NOT EXISTS (
  SELECT 1 FROM t080.items_before b LEFT JOIN public.items i ON i.id = b.id
  WHERE b.id NOT IN (pg_temp.id('s1_review_stamp'), pg_temp.id('s4_review_stamp_unminted'))
    AND (i.id IS NULL OR to_jsonb(i) IS DISTINCT FROM b.row)), 'every other item unchanged');
SELECT pg_temp.ok((SELECT count(*) FROM public.items) = (SELECT count(*) FROM t080.items_before), 'no item added or removed');
SELECT pg_temp.ok(i.custody = 'warehouse' AND i.authenticated_at IS NOT NULL AND i.review_approved_at IS NULL, 'warehouse untouched ' || t.name)
FROM t080.ids t JOIN public.items i ON i.id = t.id WHERE t.name IN ('w1_authenticated', 'w2_legacy_review_stamp') ORDER BY t.name;
SELECT pg_temp.ok(i.authenticated_at IS NOT NULL AND i.review_approved_at IS NOT NULL, 'stamp+review left as is (not in predicate)')
FROM public.items i WHERE i.id = pg_temp.id('s2_stamp_and_review');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.items WHERE custody <> 'warehouse' AND authenticated_at IS NOT NULL AND review_approved_at IS NULL),
  'no item matches the 080 predicate');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM t080.redemptions_before b LEFT JOIN public.redemptions r ON r.id = b.id WHERE to_jsonb(r) IS DISTINCT FROM b.row),
  'redemptions unchanged by 080');
-- Vault state of the moved production-shape row: seller custody, not vaulted either way.
SELECT pg_temp.ok(NOT (i.custody = 'warehouse' AND i.authenticated_at IS NOT NULL), 's1 reads as not vaulted')
FROM public.items i WHERE i.id = pg_temp.id('s1_review_stamp');

-- 2. ACL ----------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok(proacl::text = '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', 'approve acl exact: ' || proacl::text)
FROM pg_proc WHERE oid = 'public.fn_approve_submission(uuid,integer,integer)'::regprocedure;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.fn_approve_submission(uuid,integer,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.fn_approve_submission(uuid,integer,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.fn_approve_submission(uuid,integer,integer)', 'EXECUTE'), 'approve effective EXECUTE anon=f auth=t svc=t');
SELECT pg_temp.ok(md5(replace(prosrc, chr(13), '')) = '947e0f9b1dbb35169065bcc64637d699', 'approve body unchanged (079 md5)')
FROM pg_proc WHERE oid = 'public.fn_approve_submission(uuid,integer,integer)'::regprocedure;
SELECT 'AFTER|fn_approve_submission as anon -> ' || pg_temp.probe(format('SELECT public.fn_approve_submission(%L,1,1)', pg_temp.id('s3_no_stamp')), NULL, 'anon');
SELECT pg_temp.ok(pg_temp.probe(format('SELECT public.fn_approve_submission(%L,1,1)', pg_temp.id('s3_no_stamp')), NULL, 'anon')
  = 'refused 42501 permission denied for function fn_approve_submission', 'anon cannot execute approve');
SELECT pg_temp.ok(pg_temp.probe(format('SELECT public.fn_approve_submission(%L,2500,2400)', pg_temp.id('s5_pending_review')), pg_temp.id('admin')) = 'accepted',
  'admin (authenticated) still approves a seller submission');
SELECT pg_temp.ok(pg_temp.probe(format('SELECT public.fn_approve_submission(%L,2500,2400)', pg_temp.id('s5_pending_review')), pg_temp.id('seller'))
  LIKE 'refused P0001 admin privileges required%', 'non-admin authenticated refused inside');

-- 3. fn_confirm_shipment ------------------------------------------------------------------------------------------------
SELECT 'AFTER|confirm_shipment ' || n || ' as ' || who || ' -> ' || pg_temp.ship(n, who)
FROM (VALUES ('r_awaiting','seller'),('r_defaulted','seller'),('r_defaulted','admin'),('r_shipped','seller'),('r_seller_requested','seller'),
             ('r_awaiting_shipped_at','seller'),('r_warehouse_requested','admin'),('r_warehouse_defaulted','admin'),('r_defaulted','buyer')) v(n, who);
SELECT pg_temp.ok(pg_temp.ship('r_awaiting', 'seller') = 'accepted status=shipped item=shipped', 'awaiting_seller -> shipped (fulfiller)');
SELECT pg_temp.ok(pg_temp.ship('r_warehouse_requested', 'admin') = 'accepted status=shipped item=shipped', 'warehouse requested -> shipped (admin)');
SELECT pg_temp.ok(pg_temp.ship('r_defaulted', 'seller') = 'refused P0001 redemption <id> is defaulted, expected awaiting_seller', 'defaulted refused (fulfiller)');
SELECT pg_temp.ok(pg_temp.ship('r_defaulted', 'admin') = 'refused P0001 redemption <id> is defaulted, expected awaiting_seller', 'defaulted refused (admin)');
SELECT pg_temp.ok(pg_temp.ship('r_warehouse_defaulted', 'admin') = 'refused P0001 redemption <id> is defaulted, expected requested', 'warehouse defaulted refused');
SELECT pg_temp.ok(pg_temp.ship('r_shipped', 'seller') = 'refused P0001 redemption <id> is already shipped', 'shipped keeps its message');
SELECT pg_temp.ok(pg_temp.ship('r_seller_requested', 'seller') = 'refused P0001 redemption <id> is requested, expected awaiting_seller', 'seller-held requested refused');
SELECT pg_temp.ok(pg_temp.ship('r_awaiting_shipped_at', 'seller') = 'refused P0001 redemption <id> is awaiting_seller, expected awaiting_seller', 'shipped_at set refused');
SELECT pg_temp.ok(pg_temp.ship('r_defaulted', 'buyer') = 'refused P0001 only the holder of this item can confirm shipment', 'non-holder still gets the holder message first');
SELECT pg_temp.ok(pg_temp.probe(format('SELECT public.fn_confirm_shipment(%L,''SYN'',''SYN-1'')', pg_temp.id('r_awaiting')), gen_random_uuid())
  = 'refused 42501 sign in to confirm a shipment', 'no users row still refused (077)');
SELECT pg_temp.ok(p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' AND p.prosecdef
  AND p.proconfig = ARRAY['search_path=public'] AND pg_get_userbyid(p.proowner) = 'postgres'
  AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname) = 1,
  'confirm_shipment owner/acl/secdef/search_path/overloads unchanged')
FROM pg_proc p WHERE p.oid = 'public.fn_confirm_shipment(uuid,text,text)'::regprocedure;
SELECT 'AFTER|confirm_shipment md5=' || md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_confirm_shipment(uuid,text,text)'::regprocedure;
ROLLBACK;
\echo T080_ASSERT_OK
