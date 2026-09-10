-- ============================================================================
-- 047_tos_acceptance.sql
--
-- Per-account Terms acceptance: users.tos_accepted_at (null = never).
-- The tour's checkbox writes it; signed-in gating reads it, so agreeing on
-- a phone carries to desktop. LocalStorage remains the fallback for signed-
-- out visitors, who have no account to hang agreement on.
--
-- Write path is a session UPDATE: self-attestation carries no privilege,
-- and the existing users_self_update policy already scopes the ROW — only
-- the column grant is added (007 precedent).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tos_accepted_at timestamptz NULL;

REVOKE UPDATE (tos_accepted_at) ON users FROM anon;
GRANT UPDATE (tos_accepted_at) ON users TO authenticated;

COMMENT ON COLUMN users.tos_accepted_at IS
  '047: when the account holder last accepted the Terms (tour checkbox). '
  'Null means never. Written by the account itself; read for tour gating.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users'
                   AND column_name = 'tos_accepted_at') THEN
    RAISE EXCEPTION '047: users.tos_accepted_at missing';
  END IF;

  RAISE NOTICE '047 ok: tos_accepted_at live';
END $$;
