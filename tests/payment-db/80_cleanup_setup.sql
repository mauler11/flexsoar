-- 080 (post-079 cleanup) container test, part 1 of 3: fixtures, COMMITTED, then the pre-080 behaviour.
-- psql only, never npm. Run on a FRESH copy of a post-079 database, before 080. Synthetic rows only.
--   psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY [-v scenario=main|nonadmin|enrolled] -f 80_cleanup_setup.sql
-- scenario=main      the fixtures below; 080 must apply.
-- scenario=nonadmin  main + a seller item stamped by a NON-admin user; 080 must refuse and change nothing (82).
-- scenario=enrolled  main + a stamped seller item enrolled in payment_v2.inventory; 080 must refuse and change nothing (82).
-- Fixture ids and a full items snapshot are kept in schema t080 for 81/82.
\ir 00_target_guard.sql
\if :{?scenario}
\else
\set scenario main
\endif
\set QUIET 1
SET client_min_messages = notice;
BEGIN;
CREATE SCHEMA t080;
CREATE TABLE t080.ids(name text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE t080.meta(k text PRIMARY KEY, v text NOT NULL);
INSERT INTO t080.meta VALUES ('scenario', :'scenario');
CREATE FUNCTION pg_temp.mk_user(p_name text, p_admin boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid := gen_random_uuid();
BEGIN
 INSERT INTO public.users(id, auth_id, handle, email, country_code, is_admin)
 VALUES (u, u, 't80' || left(replace(u::text, '-', ''), 18), 't80-' || u || '@example.invalid', 'MY', p_admin);
 INSERT INTO t080.ids VALUES (p_name, u);
 RETURN u;
END $$;
-- p_stamp: authenticated_at/by (by p_by); p_review: review_approved_at/by (by p_by).
CREATE FUNCTION pg_temp.mk_item(p_name text, p_custody text, p_status text, p_stamp boolean, p_review boolean, p_by uuid,
  p_card_status text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i uuid := gen_random_uuid(); s uuid := (SELECT id FROM t080.ids WHERE name = 'sku'); o uuid := (SELECT id FROM t080.ids WHERE name = 'seller');
 at timestamptz := '2026-09-25 06:56:12.503478+00';
BEGIN
 INSERT INTO public.items(id, sku_id, consignor_id, status, float_value, graded_by, graded_at, custody, custody_holder_id,
                          grade_source, asking_price_cents, authenticated_at, authenticated_by, review_approved_at, review_approved_by)
 VALUES (i, s, o, p_status::public.item_status, 0.120, o, at, p_custody::public.custody_model, CASE WHEN p_custody = 'seller' THEN o END,
         CASE WHEN p_custody = 'seller' THEN 'seller_declared' ELSE 'flexsoar' END::public.grade_source, 2500,
         CASE WHEN p_stamp THEN at END, CASE WHEN p_stamp THEN p_by END,
         CASE WHEN p_review THEN at + interval '1 minute' END, CASE WHEN p_review THEN p_by END);
 INSERT INTO t080.ids VALUES (p_name, i);
 IF p_card_status IS NOT NULL THEN
  INSERT INTO public.cards(id, item_id, sku_id, owner_id, float_value, tier, mint_number, status)
  VALUES (gen_random_uuid(), i, s, o, 0.120, 1, (SELECT count(*) + 1 FROM t080.ids), p_card_status::public.card_status);
 END IF;
 RETURN i;
END $$;
-- A redemption over a fresh item + burned card. Seller-held when p_seller_held (fulfiller = seller).
CREATE FUNCTION pg_temp.mk_redemption(p_name text, p_seller_held boolean, p_status text, p_shipped boolean, p_defaulted boolean)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i uuid; c uuid := gen_random_uuid(); r uuid := gen_random_uuid(); s uuid := (SELECT id FROM t080.ids WHERE name = 'sku');
 o uuid := (SELECT id FROM t080.ids WHERE name = 'seller'); b uuid := (SELECT id FROM t080.ids WHERE name = 'buyer');
BEGIN
 i := pg_temp.mk_item(p_name || '_item', CASE WHEN p_seller_held THEN 'seller' ELSE 'warehouse' END, 'redemption_hold', NOT p_seller_held, false,
                      (SELECT id FROM t080.ids WHERE name = 'admin'));
 INSERT INTO public.cards(id, item_id, sku_id, owner_id, float_value, tier, mint_number, status)
 VALUES (c, i, s, b, 0.120, 1, (SELECT count(*) + 1 FROM t080.ids), 'burned');
 INSERT INTO public.redemptions(id, card_id, item_id, user_id, handling_fee_cents, shipping_address, status, fulfiller_id, due_by,
                                shipped_at, carrier, tracking_number, defaulted_at)
 VALUES (r, c, i, b, 0, '{"line1":"synthetic"}'::jsonb, p_status, CASE WHEN p_seller_held THEN o END,
         CASE WHEN p_seller_held THEN now() + interval '7 days' END,
         CASE WHEN p_shipped THEN now() END, CASE WHEN p_shipped THEN 'SYN' END, CASE WHEN p_shipped THEN 'SYN-0' END,
         CASE WHEN p_defaulted THEN now() END);
 INSERT INTO t080.ids VALUES (p_name, r);
 RETURN r;
END $$;

DO $fixtures$
DECLARE v text; admin uuid; seller uuid; m uuid := gen_random_uuid(); s uuid := gen_random_uuid(); i uuid; st1 uuid; st2 uuid; c uuid;
BEGIN
 admin := pg_temp.mk_user('admin', true);
 seller := pg_temp.mk_user('seller', false);
 PERFORM pg_temp.mk_user('buyer', false);
 INSERT INTO public.sku_models(id, brand, model, colorway, base_price_cents) VALUES (m, 'Synthetic080', 'M-' || m, 'Test', 2000);
 INSERT INTO public.skus(id, model_id, brand, model, colorway, size_us) VALUES (s, m, 'Synthetic080', 'Derived', 'Test', 10);
 INSERT INTO t080.ids VALUES ('sku', s);
 -- Moved by 080 (the production shape: seller, seller_declared, minted, pending_vault, admin review stamp; and a second one).
 PERFORM pg_temp.mk_item('s1_review_stamp', 'seller', 'minted', true, false, admin, 'pending_vault');
 PERFORM pg_temp.mk_item('s4_review_stamp_unminted', 'seller', 'in_custody', true, false, admin);
 -- Never touched by 080.
 PERFORM pg_temp.mk_item('s2_stamp_and_review', 'seller', 'minted', true, true, admin, 'active');
 PERFORM pg_temp.mk_item('s3_no_stamp', 'seller', 'minted', false, false, admin, 'active');
 PERFORM pg_temp.mk_item('w1_authenticated', 'warehouse', 'minted', true, false, admin, 'active');
 PERFORM pg_temp.mk_item('w2_legacy_review_stamp', 'warehouse', 'in_custody', true, false, admin);
 PERFORM pg_temp.mk_item('w3_unauthenticated', 'warehouse', 'pending_intake', false, false, admin);
 PERFORM pg_temp.mk_item('s5_pending_review', 'seller', 'pending_review', false, false, admin);
 -- Redemptions for fn_confirm_shipment.
 PERFORM pg_temp.mk_redemption('r_awaiting', true, 'awaiting_seller', false, false);
 PERFORM pg_temp.mk_redemption('r_defaulted', true, 'defaulted', false, true);
 PERFORM pg_temp.mk_redemption('r_shipped', true, 'shipped', true, false);
 PERFORM pg_temp.mk_redemption('r_seller_requested', true, 'requested', false, false);
 PERFORM pg_temp.mk_redemption('r_awaiting_shipped_at', true, 'awaiting_seller', true, false);
 PERFORM pg_temp.mk_redemption('r_warehouse_requested', false, 'requested', false, false);
 PERFORM pg_temp.mk_redemption('r_warehouse_defaulted', false, 'defaulted', false, true);

 v := (SELECT meta.v FROM t080.meta meta WHERE meta.k = 'scenario');
 IF v = 'nonadmin' THEN
  PERFORM pg_temp.mk_item('x_nonadmin_stamp', 'seller', 'minted', true, false, seller, 'active');
 ELSIF v = 'enrolled' THEN
  i := pg_temp.mk_item('x_enrolled_stamp', 'seller', 'minted', true, false, admin);
  c := gen_random_uuid();
  INSERT INTO public.cards(id, item_id, sku_id, owner_id, float_value, tier, mint_number, status) VALUES (c, i, s, seller, 0.120, 1, 999, 'active');
  st1 := gen_random_uuid(); st2 := gen_random_uuid();
  INSERT INTO payment_v2.staff(id, user_id, person_id, role, public_key) VALUES
   (st1, admin, admin, 'inventory', sha256(uuid_send(st1))), (st2, seller, seller, 'reviewer', sha256(uuid_send(st2)));
  INSERT INTO payment_v2.inventory(card_id, item_id, card_commitment, pair_commitment, custody_version, mode, enrollment_evidence, enrolled_by, approved_by)
  VALUES (c, i, sha256(uuid_send(c)), sha256(uuid_send(i)), 1, 0, sha256(uuid_send(i)), st1, st2);
 ELSIF v <> 'main' THEN
  RAISE EXCEPTION 'unknown scenario %', v;
 END IF;
END $fixtures$;

CREATE TABLE t080.items_before AS SELECT i.id, to_jsonb(i) AS row FROM public.items i;
CREATE TABLE t080.redemptions_before AS SELECT r.id, to_jsonb(r) AS row FROM public.redemptions r;
COMMIT;

-- Pre-080 behaviour (each probe in a subtransaction that is always undone). These lines are the "before" column of the
-- handoff table and prove the 81 assertions discriminate.
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
SELECT 'BEFORE|confirm_shipment ' || n || ' as ' || who || ' -> ' ||
  pg_temp.probe(format('SELECT public.fn_confirm_shipment(%L,%L,%L)', (SELECT id FROM t080.ids WHERE name = n), 'SYN', 'SYN-1'),
                (SELECT id FROM t080.ids WHERE name = who))
FROM (VALUES ('r_awaiting','seller'),('r_defaulted','seller'),('r_defaulted','admin'),('r_shipped','seller'),('r_seller_requested','seller'),
             ('r_awaiting_shipped_at','seller'),('r_warehouse_requested','admin'),('r_warehouse_defaulted','admin')) v(n, who);
SELECT 'BEFORE|fn_approve_submission as anon -> ' ||
  pg_temp.probe(format('SELECT public.fn_approve_submission(%L,1,1)', (SELECT id FROM t080.ids WHERE name = 's3_no_stamp')), NULL, 'anon');
SELECT 'BEFORE|acl fn_approve_submission=' || proacl::text FROM pg_proc WHERE oid = 'public.fn_approve_submission(uuid,integer,integer)'::regprocedure;
SELECT 'BEFORE|stamps ' || t.name || ' custody=' || i.custody || ' auth_at=' || (i.authenticated_at IS NOT NULL) || ' review_at=' || (i.review_approved_at IS NOT NULL)
FROM t080.ids t JOIN public.items i ON i.id = t.id WHERE t.name !~ '^r_' ORDER BY t.name;
\echo T080_SETUP_OK
