-- 080 (post-079 cleanup) container test, part 3 of 3: after 080 was REFUSED (scenario=nonadmin or enrolled, or before 080 ran),
-- the database is exactly the 80_cleanup_setup state: no item, ACL or function body changed. Ends with ROLLBACK.
--   psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f 82_cleanup_refused_unchanged.sql
\ir 00_target_guard.sql
\set QUIET 1
BEGIN;
CREATE FUNCTION pg_temp.ok(p boolean, label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF p IS DISTINCT FROM true THEN RAISE EXCEPTION 'T080 ASSERT FAILED: %', label; END IF; RETURN 'PASS ' || label; END $$;
\unset QUIET
SELECT 'REFUSED|scenario=' || v FROM t080.meta WHERE k = 'scenario';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM t080.items_before b FULL JOIN public.items i ON i.id = b.id WHERE to_jsonb(i) IS DISTINCT FROM b.row),
  'every item identical to the setup snapshot');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM t080.redemptions_before b FULL JOIN public.redemptions r ON r.id = b.id WHERE to_jsonb(r) IS DISTINCT FROM b.row),
  'every redemption identical to the setup snapshot');
SELECT pg_temp.ok(proacl::text = '{=X/postgres,postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', 'approve acl still includes PUBLIC')
FROM pg_proc WHERE oid = 'public.fn_approve_submission(uuid,integer,integer)'::regprocedure;
SELECT pg_temp.ok(md5(replace(prosrc, chr(13), '')) = 'a933c7a798b54219fefe3d571fe795d9', 'confirm_shipment still the 077 body')
FROM pg_proc WHERE oid = 'public.fn_confirm_shipment(uuid,text,text)'::regprocedure;
SELECT pg_temp.ok((SELECT count(*) FROM public.items WHERE custody <> 'warehouse' AND authenticated_at IS NOT NULL AND review_approved_at IS NULL) >= 2,
  'seller-review stamps still in authenticated_at');
ROLLBACK;
\echo T080_REFUSED_UNCHANGED_OK
