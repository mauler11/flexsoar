-- jsonParsed resolves inner instructions/loaded addresses differently from
-- base64 RPC results. Compare shared execution metadata exactly; preserve and
-- digest both complete responses independently.
BEGIN;
CREATE TEMP TABLE payment_v2_evidence_store_before ON COMMIT DROP AS
 SELECT oid,to_jsonb(p)-'prosrc' AS metadata,prosrc FROM pg_proc p
 WHERE oid='public.fn_payment_v2_store_chain_evidence(jsonb)'::regprocedure;
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_v2_evidence_store_before
  WHERE encode(sha256(convert_to(prosrc,'UTF8')),'hex')='20b564a7c5d7b2f799cda602d92fb0b982efcb97ea9544b5ee8c91015fddbaf7'
  AND (length(prosrc)-length(replace(prosrc,'p_evidence->''parsedRpcResult''->''meta'' IS DISTINCT FROM p_evidence->''rpcResult''->''meta''','')))/length('p_evidence->''parsedRpcResult''->''meta'' IS DISTINCT FROM p_evidence->''rpcResult''->''meta''')=1) THEN
  RAISE EXCEPTION 'unexpected evidence-store function; preserve catalog evidence before repair';
 END IF;
END $preflight$;

DO $repair$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO definition
 FROM pg_proc WHERE oid='public.fn_payment_v2_store_chain_evidence(jsonb)'::regprocedure;
 definition:=replace(definition,
  'p_evidence->''parsedRpcResult''->''meta'' IS DISTINCT FROM p_evidence->''rpcResult''->''meta''',
  '((p_evidence->''parsedRpcResult''->''meta'') - ''innerInstructions'' - ''loadedAddresses'') IS DISTINCT FROM ((p_evidence->''rpcResult''->''meta'') - ''innerInstructions'' - ''loadedAddresses'')');
 EXECUTE definition;
END $repair$;

DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM payment_v2_evidence_store_before b JOIN pg_proc p ON p.oid=b.oid
  WHERE b.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc'
  OR replace(b.prosrc,'p_evidence->''parsedRpcResult''->''meta'' IS DISTINCT FROM p_evidence->''rpcResult''->''meta''',
    '((p_evidence->''parsedRpcResult''->''meta'') - ''innerInstructions'' - ''loadedAddresses'') IS DISTINCT FROM ((p_evidence->''rpcResult''->''meta'') - ''innerInstructions'' - ''loadedAddresses'')') IS DISTINCT FROM p.prosrc) THEN
  RAISE EXCEPTION 'evidence-store repair changed behavior/metadata beyond RPC encoding-specific metadata';
 END IF;
END $postflight$;
COMMIT;
