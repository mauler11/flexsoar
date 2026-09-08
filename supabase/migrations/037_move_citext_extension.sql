-- ============================================================================
-- 037_move_citext_extension.sql
-- Move citext extension from public schema to extensions schema
-- RUN IN: Supabase SQL Editor, "Run without RLS"
-- ============================================================================

BEGIN;

-- Create extensions schema if not exists
CREATE SCHEMA IF NOT EXISTS extensions;

-- Move citext extension
DROP EXTENSION IF EXISTS citext;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

-- Update any columns using citext to use extensions.citext
-- (This is automatic in Postgres 15+, but explicit cast may help)
-- No action needed - types are schema-qualified automatically

COMMIT;

-- Verify
DO $$
DECLARE
  v_schema text;
BEGIN
  SELECT nspname INTO v_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'citext';
  RAISE NOTICE 'citext is now in schema: %', v_schema;
END $$;