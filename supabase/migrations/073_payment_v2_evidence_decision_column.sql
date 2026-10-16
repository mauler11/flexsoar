-- Qualify the decision action column where it collides with the function's
-- existing PL/pgSQL variable named action. No behavior or metadata changes.
BEGIN;
CREATE TEMP TABLE payment_v2_evidence_store_before ON COMMIT DROP AS
 SELECT oid,prosrc,to_jsonb(p)-'prosrc' AS metadata
 FROM pg_proc p WHERE oid='public.fn_payment_v2_store_chain_evidence(jsonb)'::regprocedure;

DO $preflight$
DECLARE source text;
BEGIN
 SELECT prosrc INTO source FROM payment_v2_evidence_store_before;
 IF source IS NULL
  OR (length(source)-length(replace(source,'SELECT id,escrow_id,action INTO d.id,d.escrow_id,d.action FROM payment_v2.decisions WHERE id=sid;','')))/length('SELECT id,escrow_id,action INTO d.id,d.escrow_id,d.action FROM payment_v2.decisions WHERE id=sid;')<>1
  OR (SELECT prosecdef IS DISTINCT FROM true OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR proowner<>'payment_v2_owner'::regrole FROM pg_proc WHERE oid='public.fn_payment_v2_store_chain_evidence(jsonb)'::regprocedure) THEN
  RAISE EXCEPTION 'unexpected evidence-store function; inspect catalog before repair';
 END IF;
END $preflight$;

DO $repair$
DECLARE definition text;old text:='SELECT id,escrow_id,action INTO d.id,d.escrow_id,d.action FROM payment_v2.decisions WHERE id=sid;';
 replacement text:='SELECT decision.id,decision.escrow_id,decision.action INTO d.id,d.escrow_id,d.action FROM payment_v2.decisions decision WHERE decision.id=sid;';
BEGIN
 SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE oid='public.fn_payment_v2_store_chain_evidence(jsonb)'::regprocedure;
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'evidence-store repair target missing';END IF;
 EXECUTE replace(definition,old,replacement);
END $repair$;

DO $postflight$
DECLARE old text:='SELECT id,escrow_id,action INTO d.id,d.escrow_id,d.action FROM payment_v2.decisions WHERE id=sid;';
 replacement text:='SELECT decision.id,decision.escrow_id,decision.action INTO d.id,d.escrow_id,d.action FROM payment_v2.decisions decision WHERE decision.id=sid;';
BEGIN
 IF EXISTS(SELECT 1 FROM payment_v2_evidence_store_before b JOIN pg_proc p ON p.oid=b.oid
  WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.metadata OR p.prosrc IS DISTINCT FROM replace(b.prosrc,old,replacement)) THEN
  RAISE EXCEPTION 'evidence-store changed beyond qualifying decisions.action';
 END IF;
END $postflight$;
COMMIT;
