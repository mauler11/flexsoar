-- ============================================================================
-- 040_restore_users_policy_semantics.sql
--
-- 036 rewrote the users policies with (select ...) wrapping (good for perf)
-- but changed their MEANING in two places:
--
--   1. users_self_insert lost its guards. 006 required
--        WITH CHECK (auth_id = auth.uid() AND id = auth.uid()
--                    AND is_admin = false)
--      036 kept only `id = auth.uid()`. A malicious client could pass
--      is_admin = true and self-mint an admin (005's fn_require_admin
--      would then accept it).
--
--   2. users_self_update lost its WITH CHECK and switched auth_id -> id.
--      007 deliberately ships USING + WITH CHECK on auth_id, with a
--      column-level GRANT restricting UPDATE to (handle) only — the policy
--      decides WHICH ROW, the grant decides WHICH COLUMNS.
--
-- Also restores items_public_read to 001's triple. 036 added 'released',
-- an unintended visibility expansion (no migration ever added it).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- users_self_read — 006 semantics + initplan wrapping
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT USING (
    (select auth.uid()) = auth_id
  );

-- ---------------------------------------------------------------------------
-- users_self_insert — restore full 006 WITH CHECK
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_self_insert ON public.users;
CREATE POLICY users_self_insert ON public.users
  FOR INSERT WITH CHECK (
    (select auth.uid()) = auth_id
    AND (select auth.uid()) = id
    AND is_admin = false
  );

-- ---------------------------------------------------------------------------
-- users_self_update — restore 007 USING + WITH CHECK on auth_id
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users
  FOR UPDATE USING (
    (select auth.uid()) = auth_id
  )
  WITH CHECK (
    (select auth.uid()) = auth_id
  );

-- Re-assert 007's column restriction: policy picks the row, the grant picks
-- the columns. Without this, the UPDATE policy alone would expose is_admin,
-- level, xp_total and portfolio_value_cents to self-write.
REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (handle) ON public.users TO authenticated;

-- ---------------------------------------------------------------------------
-- items_public_read — restore 001's triple
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS items_public_read ON public.items;
CREATE POLICY items_public_read ON public.items
  FOR SELECT USING (
    status IN ('minted', 'redemption_hold', 'shipped')
  );

COMMIT;

-- Verify
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid) || ' // ' ||
         COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    INTO v_def
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'users'
    AND pol.polname = 'users_self_insert';
  IF v_def NOT LIKE '%is_admin%' THEN
    RAISE EXCEPTION '040: users_self_insert lost its is_admin guard: %', v_def;
  END IF;
  RAISE NOTICE '040 ok: users policies restored (%)', v_def;
END $$;
