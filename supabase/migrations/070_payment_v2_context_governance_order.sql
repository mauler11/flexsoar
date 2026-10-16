-- Correct the governance actor aggregation to order by the approval row's FK.
-- The prior function metadata, authorization rules and returned binding stay intact.
BEGIN;
CREATE TEMP TABLE payment_v2_context_before ON COMMIT DROP AS
 SELECT oid,to_jsonb(p)-'prosrc' AS metadata,prosrc FROM pg_proc p
 WHERE oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_v2_context_before
  WHERE encode(sha256(convert_to(prosrc,'UTF8')),'hex')='e1334b1600032f250e8cde4a70c618b73a0a3cb2662bbfa7b394f77cfd9b0114'
  AND (length(prosrc)-length(replace(prosrc,'ORDER BY g.staff_id','')))/length('ORDER BY g.staff_id')=1) THEN
  RAISE EXCEPTION 'unexpected verifier-context function; preserve catalog evidence before repair';
 END IF;
END $preflight$;

DO $repair$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO definition
 FROM pg_proc WHERE oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;
 definition:=replace(definition,'ORDER BY g.staff_id','ORDER BY a.staff_id');
 EXECUTE definition;
END $repair$;

DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM payment_v2_context_before b JOIN pg_proc p ON p.oid=b.oid WHERE b.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc' OR replace(b.prosrc,'ORDER BY g.staff_id','ORDER BY a.staff_id') IS DISTINCT FROM p.prosrc) THEN
  RAISE EXCEPTION 'verifier context repair changed behavior/metadata beyond the approval ordering column';
 END IF;
END $postflight$;
COMMIT;
