-- ============================================================
-- FlexSoar — 004_rls_and_grants.sql
-- Fixes two bugs in 001_schema.sql found during track/data.
-- Run in the Supabase SQL editor, "Run without RLS".
-- ============================================================
-- BUG 1: auth.uid() returns the auth.users id. users.id is a separate
--   uuid defaulting to gen_random_uuid(). Policies comparing a
--   users.id-valued column directly against auth.uid() are therefore
--   always false — silently killing order visibility and the entire
--   early-access window. 001 was inconsistent: listings_visibility
--   joined through auth_id while the others compared directly.
--   Every policy now resolves auth.uid() the same way.
--
-- BUG 2: fn_award_xp is SECURITY DEFINER with no caller check and is
--   reachable over PostgREST. XP feeds rank_score -> level ->
--   seller_fee_bps, so any authenticated user could grant themselves
--   an unlimited fee discount. Revoked from client roles; it stays
--   callable from inside other SECURITY DEFINER functions.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Resolve auth.uid() to users.id consistently
-- ------------------------------------------------------------

create or replace function fn_current_user_id()
returns uuid language sql stable security definer as $$
  select id from users where auth_id = auth.uid();
$$;

drop policy if exists ledger_own_read on ledger_entries;
create policy ledger_own_read on ledger_entries for select
  using (account_id = fn_current_user_id());

drop policy if exists orders_own_read on orders;
create policy orders_own_read on orders for select
  using (buyer_id = fn_current_user_id() or seller_id = fn_current_user_id());

drop policy if exists listings_visibility on listings;
create policy listings_visibility on listings for select using (
  status = 'public'
  or public_at <= now()
  or seller_id = fn_current_user_id()
  or early_access_level <= coalesce(
       (select level from users where auth_id = auth.uid()), 1)
);

-- ------------------------------------------------------------
-- 2. Admins and consignors need the pre-mint pipeline
--    items_public_read hid pending_intake / in_custody from everyone,
--    including the admin grading queue that has to act on them.
-- ------------------------------------------------------------

create policy items_admin_read on items for select
  using (exists (
    select 1 from users where auth_id = auth.uid() and is_admin
  ));

create policy items_consignor_read on items for select
  using (consignor_id = fn_current_user_id());

-- ------------------------------------------------------------
-- 3. Close the PostgREST surface on internal + admin functions
--    SECURITY DEFINER functions still call each other after this;
--    the revoke only stops direct calls from anon/authenticated.
-- ------------------------------------------------------------

-- Internal helpers — never called by a client
revoke execute on function fn_award_xp(uuid, text, integer, uuid)
  from public, anon, authenticated;
revoke execute on function fn_refresh_float_percentiles(uuid)
  from public, anon, authenticated;
revoke execute on function fn_refresh_levels()
  from public, anon, authenticated;

-- Admin-only — call these with the service-role client behind the
-- /admin middleware gate, never with a user session
revoke execute on function fn_mint_card(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function fn_advance_consignment(uuid, consignment_status, uuid, text)
  from public, anon, authenticated;

-- Settlement — service-role only, called from the Stripe webhook
revoke execute on function fn_purchase_card(uuid, uuid, text)
  from public, anon, authenticated;

-- fn_list_card, fn_cancel_listing and fn_redeem_card stay callable by
-- authenticated users: each checks ownership internally before acting.

-- ------------------------------------------------------------
-- 4. Belt and braces on provisioning
--    track/data sets id = auth_id at sign-in. This makes a seed script
--    or manual insert that forgets fail loudly instead of silently
--    producing a user no policy will ever match.
-- ------------------------------------------------------------

create or replace function trg_users_id_matches_auth() returns trigger
language plpgsql as $$
begin
  if new.auth_id is not null and new.id <> new.auth_id then
    raise exception 'users.id (%) must equal auth_id (%)', new.id, new.auth_id;
  end if;
  return new;
end $$;

create trigger users_id_matches_auth
  before insert or update on users
  for each row execute function trg_users_id_matches_auth();
