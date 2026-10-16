-- Forward repair only: operations fields are compiled only for operations rows.
BEGIN;
CREATE TEMP TABLE payment_terms_before ON COMMIT DROP AS
 SELECT oid,to_jsonb(p)-'prosrc' AS metadata,prosrc FROM pg_proc p WHERE oid='payment_v2.terms_guard()'::regprocedure;
CREATE TEMP TABLE payment_terms_triggers_before ON COMMIT DROP AS
 SELECT oid,to_jsonb(t) AS metadata FROM pg_trigger t WHERE tgfoid='payment_v2.terms_guard()'::regprocedure;
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_terms_before WHERE encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex')='938607aa93e47c4a7901f222e1bc27cd4b511a5b79dd0270cb42d36c4758641c') THEN RAISE EXCEPTION 'unexpected original function body: review catalog';END IF;
 IF (SELECT count(*) FROM payment_terms_triggers_before)<>4 THEN RAISE EXCEPTION 'unexpected terms_guard attachments';END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_terms_before WHERE prosrc LIKE '%TG_TABLE_NAME=''operations'' AND NEW.resolved_event%' AND prosrc LIKE '%TG_TABLE_NAME=''operations'' AND OLD.signature%') THEN RAISE EXCEPTION 'unexpected terms_guard body';END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION payment_v2.terms_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE excluded text[];
BEGIN
 excluded:=CASE TG_TABLE_NAME WHEN 'sales' THEN ARRAY['state','fence','chain_acknowledged'] WHEN 'attempts' THEN ARRAY['state','permit','authorized_by','authorized_at']
 WHEN 'operations' THEN ARRAY['state','ready','lease_id','leased_by','worker_id','lease_until','attempts','signature','resolved_event','last_error','available_at']
 WHEN 'outbox' THEN ARRAY['state','lease_id','leased_by','lease_until','attempts','delivered_at','last_error','available_at'] ELSE ARRAY[]::text[] END;
 IF (to_jsonb(NEW)-excluded) IS DISTINCT FROM (to_jsonb(OLD)-excluded) THEN RAISE EXCEPTION 'PAYMENT_V2_TERMS_IMMUTABLE';END IF;
 IF TG_TABLE_NAME='attempts' THEN
  IF OLD.permit IS NOT NULL AND (NEW.permit,NEW.authorized_by,NEW.authorized_at) IS DISTINCT FROM (OLD.permit,OLD.authorized_by,OLD.authorized_at) THEN RAISE EXCEPTION 'PAYMENT_V2_PERMIT_IMMUTABLE';END IF;
  IF OLD.state IN('funded','direct','released','refunded') AND NEW.state IN('initiated','authorized','unresolved') THEN RAISE EXCEPTION 'PAYMENT_V2_CANNOT_FORGET_PAYMENT';END IF;
 END IF;
 IF TG_TABLE_NAME='sales' AND OLD.state IN('direct','released','refunded','revoked') AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'PAYMENT_V2_TERMINAL_IMMUTABLE';END IF;
 IF TG_TABLE_NAME='operations' THEN
  IF NEW.resolved_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_v2.events WHERE id=NEW.resolved_event AND sale_id=NEW.sale_id) THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_RESOLUTION_CONFLICT';END IF;
  IF OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature THEN RAISE EXCEPTION 'PAYMENT_V2_OPERATION_IDENTITY_IMMUTABLE';END IF;
 END IF;
 RETURN NEW;
END $$;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM payment_terms_before b JOIN pg_proc p ON p.oid=b.oid WHERE b.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc') THEN RAISE EXCEPTION 'terms_guard function metadata changed';END IF;
 IF EXISTS(SELECT oid,metadata FROM payment_terms_triggers_before EXCEPT SELECT oid,to_jsonb(t) FROM pg_trigger t WHERE tgfoid='payment_v2.terms_guard()'::regprocedure)
 OR EXISTS(SELECT oid,to_jsonb(t) FROM pg_trigger t WHERE tgfoid='payment_v2.terms_guard()'::regprocedure EXCEPT SELECT oid,metadata FROM payment_terms_triggers_before) THEN RAISE EXCEPTION 'terms_guard attachments changed';END IF;
END $postflight$;
COMMIT;
