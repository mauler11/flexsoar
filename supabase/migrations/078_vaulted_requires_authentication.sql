-- ============================================================================
-- 078_vaulted_requires_authentication.sql
--
-- Founder rule (2026-10-21): vaulted = custody 'warehouse' AND authenticated_at
-- IS NOT NULL. Never custody alone, never a column default, never the lister.
-- Requires 059-074 (and 077) applied. No arity changes.
--
-- 1. fn_payment_v2_prepare_sale (060:96) admitted sale mode 1 (vaulted/direct)
--    for any non-seller custody. Mode is now derived from the conjunction:
--      seller                                   -> 0 (escrow)
--      warehouse AND authenticated_at NOT NULL  -> 1 (direct)
--      anything else (warehouse unauthenticated, missing item) -> refused
--    The item row is already locked by payment_v2.lock_card, so the predicate
--    cannot change under the check.
--
-- 2. payment_v2.correspondence (063:41) inventory branch: same derivation, so
--    an unquarantined inventory row can never be written in mode 1 for an
--    unauthenticated warehouse item, nor in mode 0 for a received one.
--    Quarantine stays the storage-only exception (prepare refuses it).
--    Lifecycle writers are compatible: prepare touches only generation;
--    refund sets quarantined; the release acknowledgement promotes mode 1
--    after reconcile (061:74) has stamped authenticated_at from the
--    authentication_pass attestation.
--
-- 3. fn_payment_v2_record_attestation (061:153) receipt: KEEP custody
--    'warehouse' on receipt (it is the true physical location; the card stays
--    pending_vault and the escrow unreleased), but CLEAR authenticated_at /
--    authenticated_by in the same update. An escrow sale is mode 0, so the
--    item was seller-held when sold; any timestamp it carries was stamped by
--    seller review (fn_approve_submission), not by warehouse authentication.
--    Left in place, the receipt would turn that stale stamp into "vaulted"
--    the moment the parcel arrived, and it would survive an authentication
--    FAIL + refund. Release re-stamps it from the attested pass.
--
--    No window for a direct sale of an unauthenticated warehouse item:
--    between receipt and release the card is pending_vault, the listing is
--    sold, the buyer holds the claim, the sale fence is up and inventory is
--    mode 0; after a refund inventory is quarantined; after release the item
--    carries the attested timestamp. And prepare (1) refuses mode 1 unless
--    the conjunction holds under the item lock.
--
-- 4. trg_vaulted_instant_release (050) is DETACHED and dropped. It only ever
--    served the legacy cash payout hold: after 063 the sole function that
--    inserts orders is fn_payment_v2_reconcile_event, which passes
--    seller_payout and payout_release_at NULL, so the trigger returns at its
--    first IF; no client role may INSERT orders. The preguard proves this
--    from the catalog before dropping. Keeping a custody-only payout
--    shortcut attached would only invite its reuse.
--
-- Refuses while any network has funding enabled, or if any live inventory
-- row already violates the new rule (manual review first; nothing is
-- silently relabelled).
--
-- Function repairs are self-relative (as 074): each permitted change is an
-- exact single-line fragment substitution; owner, ACL, SECURITY DEFINER and
-- search_path must be identical before and after.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE m078_before ON COMMIT DROP AS
 SELECT fn.oid, fn.oid::regprocedure::text AS sig, fn.proowner, fn.proacl, fn.prosecdef, fn.proconfig, fn.provolatile,
  fn.proisstrict, fn.proparallel, fn.proleakproof, pg_get_function_identity_arguments(fn.oid) AS identity_args,
  pg_get_function_result(fn.oid) AS result_type, to_jsonb(fn)-'prosrc' AS metadata, fn.prosrc, f.frag_old, f.frag_new, f.ord
 FROM (VALUES
  (1,'public.fn_payment_v2_prepare_sale(uuid,uuid,jsonb)',
   'SELECT id,custody INTO i.id,i.custody FROM public.items WHERE id=c.item_id;',
   'SELECT id,custody,authenticated_at INTO i.id,i.custody,i.authenticated_at FROM public.items WHERE id=c.item_id;'),
  (2,'public.fn_payment_v2_prepare_sale(uuid,uuid,jsonb)',
   $f$OR v.mode<>(CASE i.custody WHEN 'seller' THEN 0 ELSE 1 END)$f$,
   $f$OR v.mode IS DISTINCT FROM (CASE WHEN i.custody='seller' THEN 0 WHEN i.custody='warehouse' AND i.authenticated_at IS NOT NULL THEN 1 END)$f$),
  (1,'payment_v2.correspondence()',
   $f$AND (NEW.quarantined OR NEW.mode=CASE i.custody WHEN 'warehouse' THEN 1 ELSE 0 END)$f$,
   $f$AND (NEW.quarantined OR NEW.mode=CASE WHEN i.custody='seller' THEN 0 WHEN i.custody='warehouse' AND i.authenticated_at IS NOT NULL THEN 1 END)$f$),
  (1,'public.fn_payment_v2_record_attestation(jsonb)',
   $f$IF d.action='receipt' THEN UPDATE public.items SET custody='warehouse',custody_holder_id=NULL WHERE id=s.item_id;END IF;$f$,
   $f$IF d.action='receipt' THEN UPDATE public.items SET custody='warehouse',custody_holder_id=NULL,authenticated_at=NULL,authenticated_by=NULL WHERE id=s.item_id;END IF;$f$)
 ) f(ord,sig,frag_old,frag_new)
 JOIN pg_proc fn ON fn.oid=f.sig::regprocedure;

DO $preguard$
DECLARE r record;v_n bigint;
BEGIN
 IF (SELECT count(*) FROM m078_before)<>4 THEN RAISE EXCEPTION '078: snapshot captured % fragment rows, expected 4',(SELECT count(*) FROM m078_before);END IF;
 FOR r IN SELECT DISTINCT oid,sig FROM m078_before LOOP
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=r.oid) AND proname=(SELECT proname FROM pg_proc WHERE oid=r.oid);
  IF v_n<>1 THEN RAISE EXCEPTION '078: expected exactly one % overload, found %',r.sig,v_n;END IF;
 END LOOP;
 FOR r IN SELECT * FROM m078_before LOOP
  IF position(E'\n' IN r.frag_old||r.frag_new)>0 OR position(E'\r' IN r.frag_old||r.frag_new)>0 THEN RAISE EXCEPTION '078: fragments must be single-line';END IF;
  IF (length(r.prosrc)-length(replace(r.prosrc,r.frag_old,'')))/length(r.frag_old)<>1 THEN
   RAISE EXCEPTION '078: fragment % of % must occur exactly once in prosrc (found %); inspect catalog before repair',
    r.ord,r.sig,(length(r.prosrc)-length(replace(r.prosrc,r.frag_old,'')))/length(r.frag_old);
  END IF;
  IF position(r.frag_new IN r.prosrc)>0 THEN RAISE EXCEPTION '078: % already carries the 078 fragment %',r.sig,r.ord;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM m078_before WHERE sig LIKE 'public.%' AND (NOT prosecdef OR proowner<>'payment_v2_owner'::regrole))
  OR EXISTS(SELECT 1 FROM m078_before WHERE sig LIKE 'payment_v2.%' AND (prosecdef OR proowner<>'payment_v2_owner'::regrole)) THEN
  RAISE EXCEPTION '078: v2 owner/definer state is not the 063 state';
 END IF;

 IF EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled) THEN RAISE EXCEPTION '078: funding must be disabled while the vaulted classifier changes';END IF;
 -- Every live (unquarantined) inventory row must already satisfy the new rule.
 SELECT count(*) INTO v_n FROM payment_v2.inventory v JOIN public.cards c ON c.id=v.card_id JOIN public.items i ON i.id=c.item_id
  WHERE NOT v.quarantined AND v.mode IS DISTINCT FROM CASE WHEN i.custody='seller' THEN 0 WHEN i.custody='warehouse' AND i.authenticated_at IS NOT NULL THEN 1 END;
 IF v_n>0 THEN RAISE EXCEPTION '078: % unquarantined inventory row(s) violate warehouse+authenticated; review before applying',v_n;END IF;

 -- trg_vaulted_instant_release serves only the retired legacy payout hold.
 IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid='public.orders'::regclass AND t.tgname='vaulted_instant_release'
     AND t.tgfoid='public.trg_vaulted_instant_release()'::regprocedure AND NOT t.tgisinternal)<>1 THEN
  RAISE EXCEPTION '078: vaulted_instant_release is not attached to public.orders as 050 left it';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace IN('public'::regnamespace,'payment_v2'::regnamespace)
   AND p.prosrc ~* 'insert\s+into\s+(public\.)?orders\M' AND p.oid<>'public.fn_payment_v2_reconcile_event(uuid)'::regprocedure) THEN
  RAISE EXCEPTION '078: a function other than fn_payment_v2_reconcile_event inserts orders: %',
   (SELECT string_agg(p.oid::regprocedure::text,', ') FROM pg_proc p WHERE p.pronamespace IN('public'::regnamespace,'payment_v2'::regnamespace)
     AND p.prosrc ~* 'insert\s+into\s+(public\.)?orders\M' AND p.oid<>'public.fn_payment_v2_reconcile_event(uuid)'::regprocedure);
 END IF;
 IF (SELECT (length(prosrc)-length(replace(prosrc,$f$e.id,0,0,NULL,NULL,CASE s.mode WHEN 0 THEN 'solana_v2_escrow' ELSE 'solana_v2_direct' END,a.id)$f$,'')))
      /length($f$e.id,0,0,NULL,NULL,CASE s.mode WHEN 0 THEN 'solana_v2_escrow' ELSE 'solana_v2_direct' END,a.id)$f$)
     FROM pg_proc WHERE oid='public.fn_payment_v2_reconcile_event(uuid)'::regprocedure)<>1
  OR (SELECT count(*) FROM regexp_matches((SELECT prosrc FROM pg_proc WHERE oid='public.fn_payment_v2_reconcile_event(uuid)'::regprocedure),'insert\s+into\s+(public\.)?orders\M','gi'))<>1 THEN
  RAISE EXCEPTION '078: the v2 order insert no longer passes seller_payout/payout_release_at NULL';
 END IF;
 IF has_table_privilege('anon','public.orders','INSERT') OR has_any_column_privilege('anon','public.orders','INSERT')
  OR has_table_privilege('authenticated','public.orders','INSERT') OR has_any_column_privilege('authenticated','public.orders','INSERT')
  OR has_table_privilege('service_role','public.orders','INSERT') OR has_any_column_privilege('service_role','public.orders','INSERT') THEN
  RAISE EXCEPTION '078: a client role can INSERT public.orders';
 END IF;
END $preguard$;

DO $repair$
DECLARE r record;v_def text;f record;
BEGIN
 FOR r IN SELECT DISTINCT oid,sig FROM m078_before LOOP
  SELECT pg_get_functiondef(r.oid) INTO v_def;
  FOR f IN SELECT frag_old,frag_new FROM m078_before WHERE oid=r.oid ORDER BY ord LOOP
   IF (length(v_def)-length(replace(v_def,f.frag_old,'')))/length(f.frag_old)<>1 THEN
    RAISE EXCEPTION '078: fragment not found exactly once in pg_get_functiondef(%)',r.sig;
   END IF;
   v_def:=replace(v_def,f.frag_old,f.frag_new);
  END LOOP;
  EXECUTE v_def;
 END LOOP;
END $repair$;

DROP TRIGGER vaulted_instant_release ON public.orders;
DROP FUNCTION public.trg_vaulted_instant_release();

DO $postguard$
DECLARE r record;v_src text;v_n bigint;
BEGIN
 FOR r IN SELECT DISTINCT oid,sig,proowner,proacl,prosecdef,proconfig,provolatile,proisstrict,proparallel,proleakproof,identity_args,result_type,metadata FROM m078_before LOOP
  SELECT prosrc INTO v_src FROM m078_before WHERE oid=r.oid LIMIT 1;
  FOR v_n IN SELECT ord FROM m078_before WHERE oid=r.oid ORDER BY ord LOOP
   v_src:=replace(v_src,(SELECT frag_old FROM m078_before WHERE oid=r.oid AND ord=v_n),(SELECT frag_new FROM m078_before WHERE oid=r.oid AND ord=v_n));
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_proc live WHERE live.oid=r.oid AND live.oid=r.sig::regprocedure
    AND live.proowner=r.proowner AND live.proacl IS NOT DISTINCT FROM r.proacl AND live.prosecdef=r.prosecdef
    AND live.proconfig IS NOT DISTINCT FROM r.proconfig AND live.provolatile=r.provolatile AND live.proisstrict=r.proisstrict
    AND live.proparallel=r.proparallel AND live.proleakproof=r.proleakproof
    AND pg_get_function_identity_arguments(live.oid)=r.identity_args AND pg_get_function_result(live.oid)=r.result_type
    AND (to_jsonb(live)-'prosrc') IS NOT DISTINCT FROM r.metadata AND live.prosrc=v_src) THEN
   RAISE EXCEPTION '078: % changed beyond its permitted fragment substitutions; rolling back',r.sig;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace=(SELECT pronamespace FROM pg_proc WHERE oid=r.oid) AND proname=(SELECT proname FROM pg_proc WHERE oid=r.oid);
  IF v_n<>1 THEN RAISE EXCEPTION '078: overload count for % is % after repair',r.sig,v_n;END IF;
 END LOOP;
 IF to_regprocedure('public.trg_vaulted_instant_release()') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND tgname='vaulted_instant_release') THEN
  RAISE EXCEPTION '078: vaulted_instant_release is still present';
 END IF;
 IF NOT has_function_privilege('payment_v2_issuer','public.fn_payment_v2_prepare_sale(uuid,uuid,jsonb)','EXECUTE')
  OR NOT has_function_privilege('payment_v2_verifier','public.fn_payment_v2_record_attestation(jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.fn_payment_v2_prepare_sale(uuid,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.fn_payment_v2_record_attestation(jsonb)','EXECUTE') THEN
  RAISE EXCEPTION '078: v2 worker EXECUTE grants changed';
 END IF;
END $postguard$;

COMMIT;
