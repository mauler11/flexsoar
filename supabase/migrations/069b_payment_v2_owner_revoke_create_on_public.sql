-- ============================================================================
-- 069b_payment_v2_owner_revoke_create_on_public.sql
--
-- Bracket CLOSE for 067b. Revokes CREATE on schema public from
-- payment_v2_owner and asserts the owner can no longer create in public by
-- any path (direct, PUBLIC, or membership).
--
-- Idempotent and safe to run standalone at any point after 059: run it
-- IMMEDIATELY if 068 or 069 fails, so the 067b grant never lingers.
-- It checks nothing about 068/069 and changes nothing else.
-- ============================================================================

BEGIN;

DO $preguard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_v2_owner') THEN
  RAISE EXCEPTION '069b: payment_v2_owner does not exist (059 not applied?); nothing to revoke';
 END IF;
END $preguard$;

REVOKE CREATE ON SCHEMA public FROM payment_v2_owner;

DO $postguard$
BEGIN
 IF has_schema_privilege('payment_v2_owner', 'public', 'CREATE') THEN
  RAISE EXCEPTION '069b: payment_v2_owner still has CREATE on public (another grant path exists); inspect immediately';
 END IF;
END $postguard$;

COMMIT;
