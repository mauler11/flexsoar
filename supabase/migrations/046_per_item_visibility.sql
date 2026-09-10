-- ============================================================================
-- 046_per_item_visibility.sql
--
-- Per-shoe profile visibility + trade-history toggle:
--
--   1. cards.show_in_profile (default true). Session clients hold no UPDATE
--      on cards (writes go through SECURITY DEFINER functions by project
--      discipline), so flipping goes through fn_set_card_visibility, which
--      checks owner-or-admin itself. Granted to authenticated.
--
--   2. users.show_trade_history (default true). The existing
--      users_self_update policy already scopes the ROW; only the column
--      grant is added (007 precedent).
--
--   3. public_profiles gains show_trade_history (profile pages never read
--      users directly). Dropped + recreated with security_invoker=false
--      restated (042: the market embed depends on definer behavior).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS show_in_profile boolean NOT NULL DEFAULT true;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS show_trade_history boolean NOT NULL DEFAULT true;

REVOKE UPDATE (show_in_profile) ON cards FROM anon;
REVOKE UPDATE (show_trade_history) ON users FROM anon;
GRANT UPDATE (show_trade_history) ON users TO authenticated;

CREATE OR REPLACE FUNCTION fn_set_card_visibility(p_card_id uuid, p_show boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM cards WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'card % not found', p_card_id;
  END IF;
  IF v_owner IS DISTINCT FROM fn_current_user_id() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'not your card';
  END IF;
  UPDATE cards SET show_in_profile = p_show WHERE id = p_card_id;
END $$;

REVOKE EXECUTE ON FUNCTION fn_set_card_visibility(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION fn_set_card_visibility(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_set_card_visibility(uuid, boolean) TO service_role;

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, handle, level, xp_total, portfolio_value_cents,
         show_collection, show_trade_history, created_at
  FROM users;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

COMMENT ON VIEW public.public_profiles IS
  'Deliberate SECURITY DEFINER (invoker=false): exposes safe columns only. '
  'See 006/007 and 042. show_collection (045, master hide) and '
  'show_trade_history (046) ride along; per-card hiding is cards.'
  'show_in_profile via fn_set_card_visibility. The '
  'security_definer_view linter finding stays accepted.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'cards'
                   AND column_name = 'show_in_profile') THEN
    RAISE EXCEPTION '046: cards.show_in_profile missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users'
                   AND column_name = 'show_trade_history') THEN
    RAISE EXCEPTION '046: users.show_trade_history missing';
  END IF;

  SELECT pg_get_viewdef(oid) INTO v_def
  FROM pg_class
  WHERE relname = 'public_profiles' AND relnamespace = 'public'::regnamespace;
  IF v_def IS NULL OR v_def NOT LIKE '%show_trade_history%' THEN
    RAISE EXCEPTION '046: public_profiles lacks show_trade_history';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'public_profiles'
                   AND c.reloptions::text LIKE '%security_invoker=false%') THEN
    RAISE EXCEPTION '046: public_profiles lost security_invoker=false';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                 JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'
                   AND p.proname = 'fn_set_card_visibility') THEN
    RAISE EXCEPTION '046: fn_set_card_visibility missing';
  END IF;

  RAISE NOTICE '046 ok: per-card + trade-history visibility live';
END $$;
