-- ============================================================================
-- 032_remove_levels_and_early_access.sql
--
-- Remove levels and early_access system entirely.
-- All listings go straight to public. No early access, no level gating.
-- Cards stay active when listed (not locked).
-- Levels table and columns kept for future re-add.
--
-- RUN IN: Supabase SQL editor, "Run without RLS". Single pass.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Update listings: remove early_access_level, set all to public
-- ---------------------------------------------------------------------------

-- First, drop the policy that depends on early_access_level
drop policy if exists listings_visibility on listings;

-- First, update existing early_access listings to public
update listings set status = 'public' where status = 'early_access';

-- Drop the early_access_level column
alter table listings drop column if exists early_access_level;

-- Drop the public_at column (no longer needed for early access timing)
alter table listings drop column if exists public_at;

-- ---------------------------------------------------------------------------
-- 2. Update cards: remove lock on listing
--    fn_list_card will no longer set status = 'locked'
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. Update levels table: keep for future but mark unused
-- ---------------------------------------------------------------------------
comment on table levels is 'UNUSED — levels system removed. Kept for future re-add.';

-- ---------------------------------------------------------------------------
-- 3. Drop levels table if empty (optional, keeping for future)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS levels;

-- ---------------------------------------------------------------------------
-- 4. Update fn_list_card to not lock cards and not use early_access
-- ---------------------------------------------------------------------------

drop function if exists fn_list_card(uuid, uuid, integer, payout_method, integer);

create function fn_list_card(
  p_card_id uuid,
  p_seller_id uuid,
  p_price_cents integer,
  p_payout_method payout_method default 'credit',
  p_fair_price_cents integer default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card    cards%rowtype;
  v_item    items%rowtype;
  v_oracle  integer;
  v_listing uuid;
  v_is_vaulted boolean;
begin
  perform fn_require_actor(p_seller_id);

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'card % not found', p_card_id; end if;
  if v_card.owner_id <> p_seller_id then
    raise exception 'card % is not owned by %', p_card_id, p_seller_id;
  end if;
  if v_card.status <> 'active' then
    raise exception 'card % is %, expected active', p_card_id, v_card.status;
  end if;

  select * into v_item from items where id = v_card.item_id;
  v_is_vaulted := (v_item.custody = 'warehouse');

  v_oracle := fn_card_value_cents(p_card_id);

  insert into listings (card_id, seller_id, price_cents, fair_price_cents, status,
                        oracle_value_cents,
                        payout_method)
  values (p_card_id, p_seller_id, p_price_cents, p_fair_price_cents,
          'public',
          v_oracle,
          p_payout_method)
  returning id into v_listing;

  -- Card stays active (no lock)
  -- update cards set status = 'locked' where id = p_card_id;  -- REMOVED

  return v_listing;
end $$;

grant execute on function fn_list_card(uuid, uuid, integer, payout_method, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Create new listing_visibility policy (no early_access check)
-- ---------------------------------------------------------------------------

create policy listings_visibility on listings
  for select using (
    status = 'public'
    and (public_at is null or public_at <= now())
  );

-- ---------------------------------------------------------------------------
-- 6. Update getListings query in contract to not filter by early_access
-- ---------------------------------------------------------------------------
-- This is handled in the TypeScript contract code

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_sig text;
begin
  -- Check fn_list_card signature
  select pg_get_function_identity_arguments(oid) into v_sig
  from pg_proc
  where proname = 'fn_list_card'
    and pronamespace = 'public'::regnamespace;
  
  if v_sig not like '%fair_price_cents%' then
    raise exception '032: fn_list_card missing fair_price_cents parameter. Got: %', v_sig;
  end if;

  -- Check early_access_level column dropped
  if exists (select 1 from information_schema.columns
             where table_name = 'listings'
               and column_name = 'early_access_level') then
    raise exception '032: early_access_level column still exists on listings';
  end if;

  -- Check public_at column dropped
  if exists (select 1 from information_schema.columns
             where table_name = 'listings'
               and column_name = 'public_at') then
    raise exception '032: public_at column still exists on listings';
  end if;

  raise notice '032 ok: levels and early_access removed';
end $$;

commit;

-- ============================================================================
-- AFTER RUNNING:
--   1. All listings are public immediately
--   2. Cards stay active when listed (not locked)
--   3. No level-based early access
--   2. Update contract.ts to remove level logic
--   3. Update UI to remove level displays
-- ============================================================================