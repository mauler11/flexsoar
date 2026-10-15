-- DRAFT / NOT RUN. Run after70's authorization expired, in the SAME disposable DB.
\ir 00_target_guard.sql
BEGIN;
DO $recovery$ DECLARE f jsonb;a payment_v2.attempts%rowtype;r jsonb;again jsonb;binding jsonb;BEGIN
 SELECT fixture.f INTO f FROM payment_db_expiry_test.fixture;
 SELECT id,buyer_id,listing_id,idempotency_key,expires_at,permit,buyer_wallet INTO a.id,a.buyer_id,a.listing_id,a.idempotency_key,a.expires_at,a.permit,a.buyer_wallet FROM payment_v2.attempts WHERE id=(f->>'attempt')::uuid;
 IF extract(epoch FROM clock_timestamp())<=a.expires_at THEN RAISE EXCEPTION 'wait until synthetic quote expires; do not modify immutable times';END IF;
 UPDATE public.users SET solana_address=payment_v2.b58(sha256(uuid_send(gen_random_uuid()))) WHERE id=a.buyer_id;
 binding:=public.fn_payment_v2_recovery_binding(f->'proof'->>'attempt',f->'proof'->>'genesis',f->'proof'->>'program');
 IF binding->>'permitHex' IS DISTINCT FROM f->>'permit' THEN RAISE EXCEPTION 'original authorization lost after relink';END IF;
 r:=public.fn_payment_v2_reconcile_event((f->>'event')::uuid);again:=public.fn_payment_v2_reconcile_event((f->>'event')::uuid);
 IF r IS DISTINCT FROM again THEN RAISE EXCEPTION 'lost-response recovery returned another order';END IF;
 PERFORM set_config('request.jwt.claim.sub',a.buyer_id::text,true);
 again:=public.fn_payment_v2_initiate(a.listing_id,a.idempotency_key,'MY-USDC-ESCROW-1','834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5');
 IF again->>'id' IS DISTINCT FROM a.id::text OR again->>'funding'<>'funded' THEN RAISE EXCEPTION 'paid attempt reset after expiry/relink';END IF;
END $recovery$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
