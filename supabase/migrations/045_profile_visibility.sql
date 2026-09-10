-- ============================================================================
-- 045_profile_visibility.sql
--
-- Sellers can hide their holdings from their public profile
-- (users.show_collection, default true). Two parts:
--
--   1. Column + write path: 007 granted UPDATE(handle) only, so the session
--      cannot touch a new column without an explicit grant. The existing
--      users_self_update policy (USING/WITH CHECK auth_id = auth.uid(),
--      restored in 040) already scopes the ROW; the grant scopes the COLUMN.
--
--   2. public_profiles gains the flag: profile pages never read users
--      directly, and a non-owner cannot read another user's row through
--      users RLS — so the flag must ride the public view. View is dropped
--      and recreated (007 precedent: CREATE OR REPLACE cannot insert a
--      column mid-list cleanly); security_invoker=false is restated
--      explicitly (042: the market embed depends on definer behavior).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS show_collection boolean NOT NULL DEFAULT true;

REVOKE UPDATE (show_collection) ON users FROM anon;
GRANT UPDATE (show_collection) ON users TO authenticated;

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, handle, level, xp_total, portfolio_value_cents,
         show_collection, created_at
  FROM users;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

COMMENT ON VIEW public.public_profiles IS
  'Deliberate SECURITY DEFINER (invoker=false): exposes safe columns only. '
  'See 006/007 and 042. show_collection (045) lets sellers hide holdings '
  'from visitors; the security_definer_view linter finding stays accepted.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users'
                   AND column_name = 'show_collection') THEN
    RAISE EXCEPTION '045: users.show_collection missing';
  END IF;

  SELECT pg_get_viewdef(oid) INTO v_def
  FROM pg_class
  WHERE relname = 'public_profiles' AND relnamespace = 'public'::regnamespace;
  IF v_def IS NULL OR v_def NOT LIKE '%show_collection%' THEN
    RAISE EXCEPTION '045: public_profiles lacks show_collection';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'public_profiles'
                   AND c.reloptions::text LIKE '%security_invoker=false%') THEN
    RAISE EXCEPTION '045: public_profiles lost security_invoker=false';
  END IF;

  RAISE NOTICE '045 ok: show_collection live, view still definer';
END $$;
