-- ============================================================================
-- 079_review_approval_is_not_authentication.sql
--
-- Founder rule (2026-10-22): items.authenticated_at means FlexSoar physically
-- holds the pair AND has authenticated it. Seller review is neither.
-- Requires 077 and 078 applied (production and staging are both there).
-- No arity changes; no data is rewritten.
--
-- 1. fn_approve_submission (041:54) stamped authenticated_at/by when an admin
--    approved a SELLER submission (013 said so itself: "attests the review,
--    not physical authentication"). It now stamps the new
--    items.review_approved_at/by instead.
--
--    Why new columns: no existing column records FlexSoar's review.
--    graded_at/graded_by are written by the SELLER at submission
--    (fn_submit_listing: graded_by = v_user), grade_source is the
--    flexsoar/seller_declared label, status 'in_custody' is transient inside
--    the approval itself, and the 'submission_approved' notification row is a
--    message, not a record of the item. Nullable, no default, FK to users
--    like authenticated_by; client roles get no write on them (063 revoked
--    table-level INSERT/UPDATE on items) and SELECT exactly as authenticated_by.
--
-- 2. fn_mint_card (027) refused any item with authenticated_at NULL, and
--    approval relied on its own stamp to pass that gate. The gate now follows
--    custody: custody 'seller' requires review_approved_at; any other custody
--    still requires authenticated_at (unchanged message, fail-closed for a
--    future custody value).
--
-- 3. fn_authenticate_item (008) stamped authenticated_at on any item in
--    pending_intake/in_custody, whatever its custody. It now refuses an item
--    that is not in warehouse custody ('item % is seller-held, cannot be
--    authenticated'), so the only writers left are warehouse authentication
--    and the v2 release after an attested authentication pass (061:74).
--
-- 4. fn_mark_default (production 013-era body, unchanged by 077; pinned below)
--    had no status check and concatenated a NULL note:
--      - a shipped or already-defaulted redemption could be defaulted again,
--        adding a second defaults_count and flipping a shipped item to
--        'released'. It now requires status 'awaiting_seller' with neither
--        shipped_at nor defaulted_at set ('redemption % is %, expected
--        awaiting_seller' -> WRONG_STATUS, as the admin client documents);
--      - grading_notes || 'DEFAULT: ' || NULL is NULL, so a NULL note erased
--        the item's grading notes (including any REJECTED line). A NULL or
--        blank note is now refused (22023).
--    Its caller check is fn_require_admin(), which refuses a NULL identity;
--    no other change is needed.
--
-- Readers checked: 078's prepare_sale/correspondence (seller -> mode 0 without
-- reading the stamp), 061 reconcile (writer), fn_grade_item (warehouse items
-- only), app/(market)/vault-status.ts (warehouse AND authenticated_at), admin
-- pages that print authenticated_at. Existing rows are NOT relabelled: the
-- production data audit (docs/handoff/payment-security.md, 079) lists them for
-- a separate decision.
--
-- Function repairs are self-relative (as 074/078): each permitted change is an
-- exact single-line fragment substitution; owner, ACL, SECURITY DEFINER and
-- search_path must be identical before and after.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE m079_before ON COMMIT DROP AS
 SELECT fn.oid, fn.oid::regprocedure::text AS sig, fn.proowner, fn.proacl, fn.prosecdef, fn.proconfig, fn.provolatile,
  fn.proisstrict, fn.proparallel, fn.proleakproof, pg_get_function_identity_arguments(fn.oid) AS identity_args,
  pg_get_function_result(fn.oid) AS result_type, to_jsonb(fn)-'prosrc' AS metadata, fn.prosrc, f.frag_old, f.frag_new, f.ord
 FROM (VALUES
  (1,'public.fn_approve_submission(uuid,integer,integer)',
   '    authenticated_by = v_admin,',
   '    review_approved_by = v_admin,'),
  (2,'public.fn_approve_submission(uuid,integer,integer)',
   '    authenticated_at = now()',
   '    review_approved_at = now()'),
  (1,'public.fn_mint_card(uuid,uuid)',
   '  if v_item.authenticated_at is null then',
   $f$  if v_item.custody = 'seller' and v_item.review_approved_at is null then raise exception 'item % is seller-held and has not been approved in review', p_item_id; end if; if v_item.custody <> 'seller' and v_item.authenticated_at is null then$f$),
  (1,'public.fn_authenticate_item(uuid,text)',
   $f$  if v_item.status not in ('pending_intake', 'in_custody') then$f$,
   $f$  if v_item.custody <> 'warehouse' then raise exception 'item % is %-held, cannot be authenticated', p_item_id, v_item.custody; end if; if v_item.status not in ('pending_intake', 'in_custody') then$f$),
  (1,'public.fn_mark_default(uuid,text)',
   '  if v_red.fulfiller_id is null then',
   $f$  if nullif(btrim(p_note), '') is null then raise exception 'a written reason is required to mark a default' using errcode = '22023'; end if; if v_red.fulfiller_id is null then$f$),
  (2,'public.fn_mark_default(uuid,text)',
   $f$  update redemptions set status = 'defaulted', defaulted_at = now()$f$,
   $f$  if v_red.status <> 'awaiting_seller' or v_red.shipped_at is not null or v_red.defaulted_at is not null then raise exception 'redemption % is %, expected awaiting_seller', p_redemption_id, v_red.status; end if; update redemptions set status = 'defaulted', defaulted_at = now()$f$)
 ) f(ord,sig,frag_old,frag_new)
 JOIN pg_proc fn ON fn.oid=f.sig::regprocedure;

DO $preguard$
DECLARE r record;v_n bigint;
BEGIN
 IF (SELECT count(*) FROM m079_before)<>6 OR (SELECT count(DISTINCT oid) FROM m079_before)<>4 THEN
  RAISE EXCEPTION '079: snapshot captured % fragment rows over % functions, expected 6 over 4',
   (SELECT count(*) FROM m079_before),(SELECT count(DISTINCT oid) FROM m079_before);
 END IF;
 FOR r IN SELECT DISTINCT oid,sig FROM m079_before LOOP
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=r.oid) AND proname=(SELECT proname FROM pg_proc WHERE oid=r.oid);
  IF v_n<>1 THEN RAISE EXCEPTION '079: expected exactly one % overload, found %',r.sig,v_n;END IF;
 END LOOP;
 FOR r IN SELECT * FROM m079_before LOOP
  IF position(E'\n' IN r.frag_old||r.frag_new)>0 OR position(E'\r' IN r.frag_old||r.frag_new)>0 THEN RAISE EXCEPTION '079: fragments must be single-line';END IF;
  IF (length(r.prosrc)-length(replace(r.prosrc,r.frag_old,'')))/length(r.frag_old)<>1 THEN
   RAISE EXCEPTION '079: fragment % of % must occur exactly once in prosrc (found %); inspect catalog before repair',
    r.ord,r.sig,(length(r.prosrc)-length(replace(r.prosrc,r.frag_old,'')))/length(r.frag_old);
  END IF;
  IF position(r.frag_new IN r.prosrc)>0 THEN RAISE EXCEPTION '079: % already carries the 079 fragment %',r.sig,r.ord;END IF;
 END LOOP;
 -- App functions as 034 left them: definer, search_path=public, one common owner that is not the v2 owner.
 IF EXISTS(SELECT 1 FROM m079_before WHERE NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=public'])
  OR (SELECT count(DISTINCT proowner) FROM m079_before)<>1
  OR EXISTS(SELECT 1 FROM m079_before WHERE proowner='payment_v2_owner'::regrole) THEN
  RAISE EXCEPTION '079: owner/definer/search_path state is not the expected app-function state';
 END IF;
 -- Approval stamps exactly the two authenticated_* columns, nothing else of that name.
 IF (SELECT (length(prosrc)-length(replace(prosrc,'authenticated_','')))/length('authenticated_') FROM m079_before
     WHERE sig='public.fn_approve_submission(uuid,integer,integer)' AND ord=1)<>2 THEN
  RAISE EXCEPTION '079: fn_approve_submission references authenticated_* other than the two stamped columns';
 END IF;
 -- fn_mark_default is the production body (cloud export, cloud-unknown-bodies-20261021.csv), CR-stripped.
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM m079_before WHERE sig='public.fn_mark_default(uuid,text)' AND ord=1)
    <>'9e32bf38bfc0f8140002bb866cc2dc1a' THEN
  RAISE EXCEPTION '079: fn_mark_default is not the audited production body (found md5 %)',
   (SELECT md5(replace(prosrc,chr(13),'')) FROM m079_before WHERE sig='public.fn_mark_default(uuid,text)' AND ord=1);
 END IF;
 -- The mint/authenticate guards branch on custody; its domain must be exactly these two values.
 IF (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='public.custody_model'::regtype)
    IS DISTINCT FROM ARRAY['warehouse','seller'] THEN
  RAISE EXCEPTION '079: custody_model is not {warehouse, seller}';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.items'::regclass AND attnum>0 AND NOT attisdropped
           AND attname IN('review_approved_at','review_approved_by')) THEN
  RAISE EXCEPTION '079: items.review_approved_* already exist';
 END IF;
 IF (SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='public.items'::regclass AND attname='authenticated_at' AND NOT attisdropped)
     IS DISTINCT FROM 'timestamp with time zone'
  OR (SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='public.items'::regclass AND attname='authenticated_by' AND NOT attisdropped)
     IS DISTINCT FROM 'uuid' THEN
  RAISE EXCEPTION '079: items.authenticated_at/by are not timestamptz/uuid';
 END IF;
 IF col_description('public.items'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='public.items'::regclass AND attname='authenticated_at')) IS NOT NULL THEN
  RAISE EXCEPTION '079: items.authenticated_at already carries a comment; refusing to overwrite it';
 END IF;
END $preguard$;

ALTER TABLE public.items
 ADD COLUMN review_approved_at timestamptz,
 ADD COLUMN review_approved_by uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.items.authenticated_at IS
 'FlexSoar physically holds the pair (custody warehouse) AND has authenticated it. Written by fn_authenticate_item (warehouse custody only since 079) and by the v2 release after an attested authentication pass (061). Never by seller review: see review_approved_at.';
COMMENT ON COLUMN public.items.review_approved_at IS
 'When an admin approved a seller submission (fn_approve_submission). A review of photos and listing, not physical authentication. Since 079.';
COMMENT ON COLUMN public.items.review_approved_by IS
 'users.id of the admin who approved the seller submission (fn_approve_submission). Since 079.';

DO $repair$
DECLARE r record;v_def text;f record;
BEGIN
 FOR r IN SELECT DISTINCT oid,sig FROM m079_before LOOP
  SELECT pg_get_functiondef(r.oid) INTO v_def;
  FOR f IN SELECT frag_old,frag_new FROM m079_before WHERE oid=r.oid ORDER BY ord LOOP
   IF (length(v_def)-length(replace(v_def,f.frag_old,'')))/length(f.frag_old)<>1 THEN
    RAISE EXCEPTION '079: fragment not found exactly once in pg_get_functiondef(%)',r.sig;
   END IF;
   v_def:=replace(v_def,f.frag_old,f.frag_new);
  END LOOP;
  EXECUTE v_def;
 END LOOP;
END $repair$;

DO $postguard$
DECLARE r record;v_src text;v_n bigint;c text;g text;p text;
BEGIN
 FOR r IN SELECT DISTINCT oid,sig,proowner,proacl,prosecdef,proconfig,provolatile,proisstrict,proparallel,proleakproof,identity_args,result_type,metadata FROM m079_before LOOP
  SELECT prosrc INTO v_src FROM m079_before WHERE oid=r.oid LIMIT 1;
  FOR v_n IN SELECT ord FROM m079_before WHERE oid=r.oid ORDER BY ord LOOP
   v_src:=replace(v_src,(SELECT frag_old FROM m079_before WHERE oid=r.oid AND ord=v_n),(SELECT frag_new FROM m079_before WHERE oid=r.oid AND ord=v_n));
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_proc live WHERE live.oid=r.oid AND live.oid=r.sig::regprocedure
    AND live.proowner=r.proowner AND live.proacl IS NOT DISTINCT FROM r.proacl AND live.prosecdef=r.prosecdef
    AND live.proconfig IS NOT DISTINCT FROM r.proconfig AND live.provolatile=r.provolatile AND live.proisstrict=r.proisstrict
    AND live.proparallel=r.proparallel AND live.proleakproof=r.proleakproof
    AND pg_get_function_identity_arguments(live.oid)=r.identity_args AND pg_get_function_result(live.oid)=r.result_type
    AND (to_jsonb(live)-'prosrc') IS NOT DISTINCT FROM r.metadata AND live.prosrc=v_src) THEN
   RAISE EXCEPTION '079: % changed beyond its permitted fragment substitutions; rolling back',r.sig;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=r.oid) AND proname=(SELECT proname FROM pg_proc WHERE oid=r.oid);
  IF v_n<>1 THEN RAISE EXCEPTION '079: overload count for % is % after repair',r.sig,v_n;END IF;
 END LOOP;
 IF position('authenticated_' IN (SELECT prosrc FROM pg_proc WHERE oid='public.fn_approve_submission(uuid,integer,integer)'::regprocedure))>0 THEN
  RAISE EXCEPTION '079: fn_approve_submission still writes authenticated_*';
 END IF;

 -- New columns: nullable, no default, FK to users(id), empty.
 FOR c,g IN SELECT t.col,t.typ FROM (VALUES('review_approved_at','timestamp with time zone'),('review_approved_by','uuid')) t(col,typ) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.items'::regclass AND attname=c AND NOT attisdropped
                AND NOT attnotnull AND NOT atthasdef AND format_type(atttypid,atttypmod)=g) THEN
   RAISE EXCEPTION '079: items.% is not a nullable % without default',c,g;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.items'::regclass AND contype='f' AND confrelid='public.users'::regclass
     AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.items'::regclass AND attname='review_approved_by')]::int2[])<>1 THEN
  RAISE EXCEPTION '079: items.review_approved_by does not reference users exactly once';
 END IF;
 IF EXISTS(SELECT 1 FROM public.items WHERE review_approved_at IS NOT NULL OR review_approved_by IS NOT NULL) THEN
  RAISE EXCEPTION '079: review_approved_* must start empty';
 END IF;

 -- Client roles: no write on the new columns; read exactly as authenticated_by.
 FOREACH g IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH c IN ARRAY ARRAY['review_approved_at','review_approved_by'] LOOP
   FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
    IF has_column_privilege(g,'public.items',c,p) THEN RAISE EXCEPTION '079: % has % on items.%',g,p,c;END IF;
   END LOOP;
   IF has_column_privilege(g,'public.items',c,'SELECT') IS DISTINCT FROM has_column_privilege(g,'public.items','authenticated_by','SELECT') THEN
    RAISE EXCEPTION '079: % SELECT on items.% differs from items.authenticated_by',g,c;
   END IF;
  END LOOP;
 END LOOP;
END $postguard$;

COMMIT;
