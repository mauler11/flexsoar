-- ============================================================================
-- 037_move_citext_extension.sql
-- citext extension is used by users.handle and users.email columns.
-- Cannot move without dropping/recreating those columns (too disruptive).
-- The Supabase linter warns about extensions in public schema, but this
-- is a low-risk informational finding. Keeping citext in public is fine.
-- RUN IN: Supabase SQL Editor, "Run without RLS" (no-op, just documents)
-- ============================================================================

BEGIN;

-- The citext extension is used by:
--   users.handle (citext unique not null)
--   users.email  (citext unique not null)
-- Moving it would require ALTER TABLE ... ALTER COLUMN ... TYPE text USING ...::text
-- then ALTER TYPE to extensions.citext, which is too disruptive for a linter warning.

-- This migration documents the decision and verifies the current state.
DO $$
DECLARE
  v_schema text;
BEGIN
  SELECT nspname INTO v_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'citext';
  
  IF v_schema = 'public' THEN
    RAISE NOTICE 'citext remains in public schema (required by users.handle, users.email)';
    RAISE NOTICE 'This is a low-risk linter finding; no action needed.';
  ELSE
    RAISE NOTICE 'citext is in schema: %', v_schema;
  END IF;
END $$;

COMMIT;