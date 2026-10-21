-- ============================================================================
-- 067b_payment_v2_owner_create_on_public.sql
--
-- Bracket OPEN for 068/069 on a non-superuser migration role (Supabase
-- `postgres`). Founder decision 2026-10-21.
--
-- 063:177 revokes CREATE on schema public from payment_v2_owner. 068 and 069
-- then create new public.fn_payment_v2_* functions and transfer them with
-- ALTER FUNCTION ... OWNER TO payment_v2_owner (068:232, 069:80). PostgreSQL
-- requires the NEW owner to hold CREATE on the function's schema; only a
-- superuser skips that check. As `postgres` on Supabase, 068 therefore fails
-- atomically with: permission denied for schema public (staging, 2026-10-21).
--
-- This file re-grants CREATE on public to payment_v2_owner for exactly the
-- 068/069 window. 069b revokes it and asserts it is gone. If 068 or 069 fails,
-- STOP and run 069b immediately: the grant must never linger.
-- payment_v2_owner is NOLOGIN and no worker is a member of it, so the window
-- grants nothing to any login other than the migration role itself.
--
-- Requires 059-067 applied, 068 NOT applied. Changes no function, table or
-- other privilege.
-- ============================================================================

BEGIN;

DO $preguard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_v2_owner' AND NOT rolcanlogin AND NOT rolsuper) THEN
  RAISE EXCEPTION '067b: payment_v2_owner missing, or it can log in / is superuser; inspect before granting';
 END IF;
 IF to_regnamespace('payment_v2') IS NULL
  OR to_regprocedure('public.fn_payment_v2_own_attempts(uuid)') IS NULL THEN
  RAISE EXCEPTION '067b: 059-067 are not applied';
 END IF;
 IF to_regprocedure('public.fn_payment_v2_ack_context(uuid)') IS NOT NULL
  OR to_regclass('payment_v2.verified_chain_evidence') IS NOT NULL THEN
  RAISE EXCEPTION '067b: 068 is already applied; this bracket is only for the 068/069 window';
 END IF;
 IF has_schema_privilege('payment_v2_owner', 'public', 'CREATE') THEN
  RAISE EXCEPTION '067b: payment_v2_owner already has CREATE on public (063 expected it revoked); inspect, then run 069b';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
            WHERE m.roleid = 'payment_v2_owner'::regrole AND r.rolname LIKE 'payment\_v2\_%') THEN
  RAISE EXCEPTION '067b: a payment_v2 worker role is a member of payment_v2_owner; refusing';
 END IF;
END $preguard$;

GRANT CREATE ON SCHEMA public TO payment_v2_owner;

DO $postguard$
BEGIN
 IF NOT has_schema_privilege('payment_v2_owner', 'public', 'CREATE') THEN
  RAISE EXCEPTION '067b: grant did not take effect';
 END IF;
END $postguard$;

COMMIT;
