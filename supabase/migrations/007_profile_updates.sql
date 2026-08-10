-- ============================================================
-- FlexSoar — 007_profile_updates.sql
-- Run in the Supabase SQL editor, "Run without RLS".
-- ============================================================
-- Two follow-ons from 006.
--
-- 1. public_profiles gains portfolio_value_cents. It is not secret —
--    anyone can derive it by summing a user's publicly visible cards —
--    and app/(market)/u/[handle] needs it. email, auth_id, kyc_status
--    and is_admin stay out.
--
-- 2. 006 shipped no UPDATE policy at all, so nobody could change their
--    own handle. Adding a plain UPDATE policy would expose every column
--    including is_admin, which 005's fn_require_admin() trusts. RLS is
--    row-level and cannot narrow that, so the column restriction comes
--    from a column-level GRANT instead: the policy decides WHICH ROW,
--    the grant decides WHICH COLUMNS.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Portfolio value on the public view
-- ------------------------------------------------------------

create or replace view public_profiles
with (security_invoker = false) as
  select id, handle, level, xp_total, portfolio_value_cents, created_at
  from users;

grant select on public_profiles to anon, authenticated;

-- ------------------------------------------------------------
-- 2. Handle-only self-update
-- ------------------------------------------------------------

create policy users_self_update on users for update
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- Table-wide UPDATE is removed and only `handle` granted back, so
-- is_admin, level, xp_total and portfolio_value_cents stay writable
-- only by service-role (fn_refresh_levels) regardless of the policy.
revoke update on users from authenticated;
grant update (handle) on users to authenticated;

-- Handles appear in provenance chains, so they should not churn freely.
-- Enforce a shape and let the existing unique index handle collisions.
alter table users add constraint users_handle_format
  check (handle ~ '^[a-zA-Z0-9._-]{3,24}$');
