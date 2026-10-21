-- ============================================================================
-- 077_drift_repair_and_null_identity_guards.sql
--
-- Cloud drift repair (docs/handoff/payment-security.md, "Cloud schema drift
-- audit") plus the null-identity fail-open class.
--
-- STARTING STATE IS THE CLOUD, NOT A NUMERIC REPLAY. The cloud runs 001-058,
-- 075 and 076, with 013-era bodies for fn_confirm_shipment / fn_record_proof /
-- fn_mark_default and the 009 body of fn_mark_shipped (014 never landed for
-- them). The preguard pins every body this file replaces to the founder's
-- cloud export (cloud-unknown-bodies-20261021.csv) and refuses anything else.
-- A fresh 001->078 replay in numeric order therefore STOPS here by design;
-- replays load the cloud bodies first. Apply 077 BEFORE 059-074.
--
-- Fingerprints are md5(replace(prosrc, chr(13), '')): the cloud stores CRLF
-- bodies (SQL-editor paste), the repo is LF, and either must match.
--
-- THE NULL-IDENTITY CLASS. A caller is derived as
-- `select id from users where auth_id = auth.uid()` (directly or through
-- fn_current_user_id()). A session with no users row yields NULL. Compared to
-- a nullable column with IS DISTINCT FROM, NULL vs NULL is "not distinct" and
-- the guard passes; compared with <>, the result is NULL and the IF is
-- skipped. Every guard below now refuses a NULL caller before any ownership
-- comparison. Admin overrides stay explicit (an admin always has a users row,
-- so the NULL check never blocks one). Service-role paths with no session
-- claims are unchanged.
--
--   fn_confirm_shipment      warehouse redemption: fulfiller_id NULL = caller NULL
--   fn_record_proof          warehouse item: custody_holder_id NULL = caller NULL
--                            (holder-only by design: no admin override, see
--                            components/admin/db-writes.ts)
--   fn_require_actor         p_claimed NULL = caller NULL; fn_cancel_listing then
--                            tested seller_id <> NULL and cancelled ANY listing
--   fn_require_self_or_admin p_user NULL = caller NULL (no effect today: balance
--                            of NULL is 0; fixed as the guard it is)
--   fn_resolve_trade_offer   recipient_id <> NULL / initiator_id <> NULL skipped
--                            both raises: anyone could resolve any open offer
--
-- Also: (b) fn_mark_shipped gets 014's seller-held guard back; (c) the dead
-- FSC top-up fn_purchase_credit is dropped; (d) the four cloud-only
-- sku_models columns are captured and the duplicate skus CHECK is dropped.
--
-- Signatures, SECURITY DEFINER, search_path, owner and ACL are preserved and
-- asserted. No arity changes.
--
-- RUN IN: Supabase SQL editor (postgres) or psql -f. Single transaction.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE m077_before ON COMMIT DROP AS
 SELECT p.oid, p.oid::regprocedure::text AS sig, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig,
        md5(replace(p.prosrc, chr(13), '')) AS lf_md5
 FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('fn_mark_shipped','fn_confirm_shipment','fn_record_proof','fn_require_actor',
                     'fn_require_self_or_admin','fn_resolve_trade_offer','fn_purchase_credit');

DO $preguard$
DECLARE
 r record; v_n bigint; v_https text; v_dup text; v_c record;
BEGIN
 -- Exactly the cloud bodies, one overload each, definer + search_path=public.
 FOR r IN SELECT * FROM (VALUES
   ('fn_mark_shipped(uuid,text,text)',          'b2b17f370a9899ff5f05cd6c12cef0a3'),
   ('fn_confirm_shipment(uuid,text,text)',      '99863a69288d7ae512de86be10f04d8d'),
   ('fn_record_proof(uuid,jsonb)',              '0f3605b5d9a7dda87ce5d273c1c4884e'),
   ('fn_require_actor(uuid)',                   '958351738a687dcc5b3c48942cdff4bc'),
   ('fn_require_self_or_admin(uuid)',           '45016886b51f58b411641186e3991c04'),
   ('fn_resolve_trade_offer(uuid,text)',        '38af15d3d641890587c4fc93860f9291'),
   ('fn_purchase_credit(uuid,bigint,text)',     'b47f89c42bdafa6d8e2352157672bf89')
 ) t(sig, lf_md5) LOOP
  SELECT count(*) INTO v_n FROM m077_before WHERE proname = split_part(r.sig, '(', 1);
  IF v_n <> 1 THEN
   RAISE EXCEPTION '077: expected exactly one public.% overload, found %', split_part(r.sig, '(', 1), v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM m077_before b WHERE b.sig = r.sig AND b.lf_md5 = r.lf_md5
                 AND b.prosecdef AND b.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']) THEN
   RAISE EXCEPTION '077: public.% is not the expected cloud body/definer/search_path (found md5 %); inspect catalog before repair',
    r.sig, (SELECT lf_md5 FROM m077_before WHERE proname = split_part(r.sig, '(', 1));
  END IF;
 END LOOP;

 -- (c) nothing may still call the FSC top-up: no other body names it, nothing depends on it.
 IF EXISTS (SELECT 1 FROM pg_proc p
            WHERE p.pronamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('public','payment_v2'))
              AND p.proname <> 'fn_purchase_credit' AND p.prosrc ILIKE '%fn_purchase_credit%') THEN
  RAISE EXCEPTION '077: another function body references fn_purchase_credit; refusing to drop';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_depend WHERE refclassid = 'pg_proc'::regclass
            AND refobjid = 'public.fn_purchase_credit(uuid,bigint,text)'::regprocedure) THEN
  RAISE EXCEPTION '077: objects depend on fn_purchase_credit; refusing to drop';
 END IF;

 -- (d) skus_art_url_check may be dropped only if skus_art_url_https enforces the identical predicate.
 SELECT pg_get_constraintdef(oid) INTO v_https FROM pg_constraint
  WHERE conrelid = 'public.skus'::regclass AND conname = 'skus_art_url_https' AND contype = 'c' AND convalidated;
 IF v_https IS NULL OR md5(v_https) <> 'c2915a824e3c8b4dc50473a093e0cc4e' THEN
  RAISE EXCEPTION '077: skus_art_url_https missing, unvalidated or not the expected definition (%)', v_https;
 END IF;
 FOR v_c IN SELECT c.conname, c.contype, c.convalidated, c.connoinherit, pg_get_constraintdef(c.oid) AS def
            FROM pg_constraint c WHERE c.conrelid = 'public.skus'::regclass AND c.conname = 'skus_art_url_check' LOOP
  IF v_c.contype <> 'c' OR v_c.def IS DISTINCT FROM v_https OR NOT v_c.convalidated
     OR v_c.connoinherit IS DISTINCT FROM (SELECT connoinherit FROM pg_constraint
                                           WHERE conrelid = 'public.skus'::regclass AND conname = 'skus_art_url_https') THEN
   RAISE EXCEPTION '077: skus_art_url_check is not an exact duplicate of skus_art_url_https (%)', v_c.def;
  END IF;
 END LOOP;

 -- (d) a cloud-only column that already exists must already have the cloud type.
 FOR r IN SELECT c.column_name, c.data_type, c.is_nullable, c.column_default FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = 'sku_models'
            AND c.column_name IN ('external_id','gender','source','style_code') LOOP
  IF r.data_type <> 'text'
     OR (r.column_name = 'source' AND (r.is_nullable <> 'NO' OR r.column_default IS DISTINCT FROM '''manual''::text'))
     OR (r.column_name <> 'source' AND (r.is_nullable <> 'YES' OR r.column_default IS NOT NULL)) THEN
   RAISE EXCEPTION '077: sku_models.% exists with an unexpected definition (%, nullable %, default %)',
    r.column_name, r.data_type, r.is_nullable, r.column_default;
  END IF;
 END LOOP;
END $preguard$;

-- ----------------------------------------------------------------------------
-- (b) fn_mark_shipped: 014's body. The cloud still runs 009's, which marks a
-- seller-held parcel shipped without crediting fulfilments_completed.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_mark_shipped(p_redemption_id uuid, p_carrier text, p_tracking text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_red redemptions%rowtype;
begin
  perform fn_require_admin();

  select * into v_red from redemptions where id = p_redemption_id for update;
  if not found then raise exception 'redemption % not found', p_redemption_id; end if;

  -- Seller-held parcels must go through fn_confirm_shipment, which is
  -- what credits the seller's fulfilment count.
  if v_red.fulfiller_id is not null then
    raise exception
      'redemption % is seller-held; use fn_confirm_shipment', p_redemption_id;
  end if;

  if v_red.status = 'shipped' then
    raise exception 'redemption % is already shipped', p_redemption_id;
  end if;

  update redemptions set
    status = 'shipped', carrier = p_carrier,
    tracking_number = p_tracking, shipped_at = now()
  where id = p_redemption_id;

  update items set status = 'shipped' where id = v_red.item_id;
end $function$;

-- ----------------------------------------------------------------------------
-- (a) fn_confirm_shipment: the cloud (013) body plus a NULL-caller refusal.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_confirm_shipment(p_redemption_id uuid, p_carrier text, p_tracking text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_red   redemptions%rowtype;
  v_user  uuid;
  v_admin boolean;
begin
  select id into v_user from users where auth_id = auth.uid();
  v_admin := fn_is_admin();

  -- 077: on a warehouse redemption fulfiller_id is null, and a session with
  -- no users row has v_user null; null is not distinct from null, so the
  -- holder check below used to pass. Refuse a null caller first.
  if v_user is null and not v_admin then
    raise exception 'sign in to confirm a shipment' using errcode = '42501';
  end if;

  select * into v_red from redemptions where id = p_redemption_id for update;
  if not found then raise exception 'redemption % not found', p_redemption_id; end if;
  if v_red.status = 'shipped' then
    raise exception 'redemption % is already shipped', p_redemption_id;
  end if;
  if not v_admin and v_red.fulfiller_id is distinct from v_user then
    raise exception 'only the holder of this item can confirm shipment';
  end if;
  if coalesce(p_carrier,'') = '' or coalesce(p_tracking,'') = '' then
    raise exception 'carrier and tracking are both required';
  end if;

  update redemptions set
    status = 'shipped', carrier = p_carrier,
    tracking_number = p_tracking, shipped_at = now()
  where id = p_redemption_id;

  update items set status = 'shipped' where id = v_red.item_id;

  if v_red.fulfiller_id is not null then
    update users set fulfilments_completed = fulfilments_completed + 1
    where id = v_red.fulfiller_id;
  end if;
end $function$;

-- ----------------------------------------------------------------------------
-- (a) fn_record_proof: the cloud (013) body plus a NULL-caller refusal.
-- Holder-only; no admin override, as before.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_record_proof(p_item_id uuid, p_photos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid;
  v_item items%rowtype;
begin
  select id into v_user from users where auth_id = auth.uid();

  -- 077: a warehouse item has custody_holder_id null; a null caller matched it.
  if v_user is null then
    raise exception 'sign in to record proof' using errcode = '42501';
  end if;

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;
  if v_item.custody_holder_id is distinct from v_user then
    raise exception 'you are not holding this item';
  end if;

  perform fn_set_item_photos(p_item_id, p_photos);
  update items set last_proof_at = now() where id = p_item_id;
end $function$;

-- ----------------------------------------------------------------------------
-- (a) fn_require_actor: refuse a NULL session caller. Its callers
-- (fn_cancel_listing, fn_list_card, fn_redeem_card) compare with <> after it.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_require_actor(p_claimed uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claims text;
  v_role   text;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  if v_claims is null then
    return;  -- migrations, psql, the webhook
  end if;

  begin
    v_role := coalesce(v_claims::jsonb ->> 'role', '');
  exception when others then
    raise exception 'not authorised: session claims could not be read';
  end;

  if v_role not in ('anon', 'authenticated') then
    return;  -- service_role
  end if;

  -- 077: a session with no users row is null, and null is not distinct from
  -- a null p_claimed. fn_cancel_listing then tested seller_id <> null (null)
  -- and cancelled the listing. Refuse a null caller first.
  if fn_current_user_id() is null then
    raise exception 'sign in to act on this account' using errcode = '42501';
  end if;

  if fn_current_user_id() is distinct from p_claimed and not fn_is_admin() then
    raise exception 'not authorised to act as another user';
  end if;
end $function$;

-- ----------------------------------------------------------------------------
-- (a) fn_require_self_or_admin: same shape, same refusal.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_require_self_or_admin(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claims text;
  v_role   text;
begin
  -- nullif collapses "never set" and "set to empty" into one NULL case.
  v_claims := nullif(current_setting('request.jwt.claims', true), '');

  -- No claims at all: service_role, webhook, psql, migrations. Allowed --
  -- service_role can read ledger_entries directly regardless, so refusing
  -- here would break settlement without preventing anything.
  if v_claims is null then
    return;
  end if;

  -- Claims present but unreadable. Fail closed.
  begin
    v_role := coalesce(v_claims::jsonb ->> 'role', '');
  exception when others then
    raise exception 'not authorised: session claims could not be read';
  end;

  if v_role not in ('anon', 'authenticated') then
    return;
  end if;

  -- 077: a null caller is not distinct from a null p_user. Refuse it first.
  if fn_current_user_id() is null then
    raise exception 'sign in to read a balance' using errcode = '42501';
  end if;

  if fn_current_user_id() is distinct from p_user and not fn_is_admin() then
    raise exception 'not authorised to read another user''s balance';
  end if;
end $function$;

-- ----------------------------------------------------------------------------
-- (a) fn_resolve_trade_offer: recipient_id <> null and initiator_id <> null
-- are null, so both ownership raises were skipped for a null caller.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_resolve_trade_offer(p_offer_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := fn_current_user_id();
  v_o    trade_offers%rowtype;
begin
  -- 077: refuse a null caller before the <> ownership checks below.
  if v_user is null then
    raise exception 'sign in to resolve a trade offer' using errcode = '42501';
  end if;

  if p_status not in ('declined','cancelled') then
    raise exception 'unsupported resolution %', p_status;
  end if;

  select * into v_o from trade_offers where id = p_offer_id for update;
  if not found then raise exception 'offer % not found', p_offer_id; end if;
  if v_o.status <> 'open' then
    raise exception 'offer % is %', p_offer_id, v_o.status;
  end if;

  -- The recipient declines; the initiator withdraws.
  if p_status = 'declined' and v_o.recipient_id <> v_user and not fn_is_admin() then
    raise exception 'offer % was not made to you', p_offer_id;
  end if;
  if p_status = 'cancelled' and v_o.initiator_id <> v_user and not fn_is_admin() then
    raise exception 'offer % is not yours to withdraw', p_offer_id;
  end if;

  update trade_offers set status = p_status, resolved_at = now()
   where id = p_offer_id;

  -- Release the reservation, or the FSC stays stuck until the TTL runs out.
  if v_o.hold_id is not null then
    update credit_holds set status = 'released', released_at = now()
     where id = v_o.hold_id and status = 'active';
  end if;
end $function$;

-- ----------------------------------------------------------------------------
-- (c) FSC is earned, never bought (AGENT_RULES §5). The top-up has had no
-- grant since 021 and no app caller since contract.ts dropped purchaseCredit().
-- ----------------------------------------------------------------------------

DROP FUNCTION public.fn_purchase_credit(uuid, bigint, text);

-- ----------------------------------------------------------------------------
-- (d) Capture the cloud-only catalog columns (types from the cloud export;
-- no-ops on the cloud) and drop the duplicate CHECK proven identical above.
-- ----------------------------------------------------------------------------

ALTER TABLE public.sku_models
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS gender      text,
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS style_code  text;

ALTER TABLE public.skus DROP CONSTRAINT IF EXISTS skus_art_url_check;

DO $postguard$
DECLARE r record; v_n bigint;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('fn_mark_shipped(uuid,text,text)',     '682fc945df379db065f2a2b20a67ee0e'),
   ('fn_confirm_shipment(uuid,text,text)', 'a933c7a798b54219fefe3d571fe795d9'),
   ('fn_record_proof(uuid,jsonb)',         '93a3e4ee086ab05174e8a79d18bd3cee'),
   ('fn_require_actor(uuid)',              'b691279eb8190bc6de825447de0cc519'),
   ('fn_require_self_or_admin(uuid)',      '9698d5f6def5d96d3c275b4476a1e21a'),
   ('fn_resolve_trade_offer(uuid,text)',   '372435c8a07d5c0c4771274b26f4f9e2')
 ) t(sig, lf_md5) LOOP
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = split_part(r.sig, '(', 1);
  IF v_n <> 1 THEN RAISE EXCEPTION '077: overload count for % is % after repair', r.sig, v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM m077_before b JOIN pg_proc live ON live.oid = b.oid
                 WHERE b.sig = r.sig
                   AND live.oid = ('public.' || r.sig)::regprocedure
                   AND live.proowner = b.proowner
                   AND live.proacl IS NOT DISTINCT FROM b.proacl
                   AND live.prosecdef
                   AND live.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']
                   AND md5(replace(live.prosrc, chr(13), '')) = r.lf_md5) THEN
   RAISE EXCEPTION '077: % changed beyond its body, or its body is not the 077 body', r.sig;
  END IF;
  IF has_function_privilege('anon', ('public.' || r.sig)::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', ('public.' || r.sig)::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('service_role', ('public.' || r.sig)::regprocedure, 'EXECUTE') THEN
   RAISE EXCEPTION '077: EXECUTE on % is not {authenticated, service_role} without anon', r.sig;
  END IF;
 END LOOP;

 IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_purchase_credit') THEN
  RAISE EXCEPTION '077: fn_purchase_credit still exists';
 END IF;

 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.skus'::regclass AND conname = 'skus_art_url_check')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.skus'::regclass AND conname = 'skus_art_url_https'
                   AND convalidated AND md5(pg_get_constraintdef(oid)) = 'c2915a824e3c8b4dc50473a093e0cc4e') THEN
  RAISE EXCEPTION '077: skus art_url constraints are not exactly {skus_art_url_https}';
 END IF;

 SELECT count(*) INTO v_n FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'sku_models' AND c.data_type = 'text'
    AND ((c.column_name IN ('external_id','gender','style_code') AND c.is_nullable = 'YES' AND c.column_default IS NULL)
      OR (c.column_name = 'source' AND c.is_nullable = 'NO' AND c.column_default = '''manual''::text'));
 IF v_n <> 4 THEN RAISE EXCEPTION '077: expected the 4 cloud sku_models columns, matched %', v_n; END IF;
END $postguard$;

COMMIT;
