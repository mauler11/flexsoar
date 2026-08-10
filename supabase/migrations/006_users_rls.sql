-- ============================================================
-- FlexSoar — 006_users_rls.sql
-- Run in the Supabase SQL editor, "Run without RLS".
-- ============================================================
-- `users` was the one table 001 never enabled RLS on, so every row —
-- email included — was readable by anyone holding the anon key, which
-- ships in the client bundle by design.
--
-- Two traps this migration works around:
--
-- 1. RECURSION. A policy ON users that does `exists (select 1 from
--    users where ...)` re-enters the same policy and Postgres errors
--    with infinite recursion. Both checks below therefore go through
--    SECURITY DEFINER functions, which run as the owner and bypass RLS.
--
-- 2. RLS IS ROW-LEVEL, NOT COLUMN-LEVEL. There is no policy that hides
--    `email` while exposing `handle`. Public profiles and the handles
--    on provenance chains therefore read from a view exposing only the
--    safe columns, not from the table.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Recursion-safe admin check
-- ------------------------------------------------------------

create or replace function fn_is_admin()
returns boolean language sql stable security definer as $$
  select coalesce((select is_admin from users where auth_id = auth.uid()), false);
$$;

-- ------------------------------------------------------------
-- 2. Enable RLS and grant the minimum
-- ------------------------------------------------------------

alter table users enable row level security;

create policy users_self_read on users for select
  using (auth_id = auth.uid());

create policy users_admin_read on users for select
  using (fn_is_admin());

-- First sign-in provisioning. The is_admin guard matters: without it a
-- user could self-provision straight into the admin role, which 005's
-- fn_require_admin() would then happily accept.
create policy users_self_insert on users for insert
  with check (
    auth_id = auth.uid()
    and id = auth.uid()
    and is_admin = false
  );

-- Deliberately no UPDATE policy. level, xp_total and portfolio_value_cents
-- are written by fn_refresh_levels under service-role, and is_admin must
-- never be self-assignable. Add a column-scoped update path here when
-- users need to edit their own handle.

-- ------------------------------------------------------------
-- 3. Public profile view — safe columns only
--    For app/(market)/u/[handle], owner handles on listings, and the
--    provenance chain. Never exposes email, auth_id or kyc_status.
-- ------------------------------------------------------------

create or replace view public_profiles
with (security_invoker = false) as
  select id, handle, level, xp_total, created_at
  from users;

grant select on public_profiles to anon, authenticated;
