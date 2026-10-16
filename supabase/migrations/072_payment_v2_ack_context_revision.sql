-- Claim acknowledgement plans must include the sale generation/revision from
-- the committed database state so lifecycle reconciliation can verify it.
BEGIN;
CREATE TEMP TABLE payment_v2_ack_context_before ON COMMIT DROP AS
 SELECT oid,to_jsonb(p)-'prosrc' AS metadata,prosrc FROM pg_proc p
 WHERE oid='public.fn_payment_v2_ack_context(uuid)'::regprocedure;
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_v2_ack_context_before
  WHERE encode(sha256(convert_to(prosrc,'UTF8')),'hex')='6632fea49297eb042ae946eda120faa3f8f61dea8f71e544e97a35ca7f77386a'
  AND (length(prosrc)-length(replace(prosrc,',''kind'',e.kind','')))/length(',' || '''kind''' || ',e.kind')=1) THEN
  RAISE EXCEPTION 'unexpected acknowledgement context; preserve catalog evidence before repair';
 END IF;
END $preflight$;

DO $repair$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO definition
 FROM pg_proc WHERE oid='public.fn_payment_v2_ack_context(uuid)'::regprocedure;
 definition:=replace(definition,',''kind'',e.kind',',''generation'',s.generation::text,''revision'',s.revision::text,''custodyVersion'',s.custody_version::text,''kind'',e.kind');
 EXECUTE definition;
END $repair$;

DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM payment_v2_ack_context_before b JOIN pg_proc p ON p.oid=b.oid
  WHERE b.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc'
  OR replace(b.prosrc,',''kind'',e.kind',',''generation'',s.generation::text,''revision'',s.revision::text,''custodyVersion'',s.custody_version::text,''kind'',e.kind') IS DISTINCT FROM p.prosrc) THEN
  RAISE EXCEPTION 'acknowledgement context changed beyond adding the stored lifecycle binding';
 END IF;
END $postflight$;
COMMIT;
