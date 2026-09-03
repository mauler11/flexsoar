-- ============================================================================
-- 029_fair_price_and_vaulted_listings.sql
--
-- 1. fair_price_cents on listings (optional, admin-set at approval)
-- 2. Auto-fill fair price on relist of vaulted cards
-- 3. Ensure wizard (admin) listings go straight to active (no pending_vault)
--
-- RUN IN: Supabase SQL editor, "Run without RLS". Single pass.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. fair_price_cents on listings
-- ---------------------------------------------------------------------------

alter table listings
  add column if not exists fair_price_cents integer;

comment on column listings.fair_price_cents is
  'Admin-set fair price for this specific card in its current condition. '
  'Optional — shown to buyers as "Fair: $X" beside oracle and ask. '
  'Auto-filled on relist of vaulted cards from the last listing''s fair_price_cents.';

-- ---------------------------------------------------------------------------
-- 2. Helper: get last fair price for a card (for auto-fill on relist)
-- ---------------------------------------------------------------------------

create or replace function fn_last_fair_price(p_card_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_fair integer;
begin
  select fair_price_cents into v_fair
  from listings
  where card_id = p_card_id
    and fair_price_cents is not null
  order by created_at desc
  limit 1;
  return v_fair;
end $$;

revoke execute on function fn_last_fair_price(uuid) from public, anon, authenticated;
grant  execute on function fn_last_fair_price(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Ensure fn_list_card uses fair_price_cents from the listing row
--    (already passed by the admin approval flow; fn_list_card just stores it)
--    No change needed to fn_list_card — it already takes p_price_cents as the ask.
--    fair_price_cents is a separate column set by the approval action.
--
-- ---------------------------------------------------------------------------
-- 4. Auto-approve relist for vaulted cards (custody = 'warehouse')
--    When a card with custody='warehouse' is listed, it goes straight to active
--    without pending_vault. The vault intake trigger (023c) only fires for
--    cards whose item.custody = 'seller' (i.e., not yet vaulted).
--
--    This is already handled by 023c's AFTER INSERT on orders trigger:
--    it only opens a vault_intake when the item is NOT in warehouse.
--    So relisting a vaulted card works correctly — just ensure the listing
--    action doesn't try to force pending_vault.
--
--    Additional guard: fn_list_card already checks card status = 'active'.
--    A vaulted card is 'active', so it lists immediately.
--
-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'listings'
                   and column_name = 'fair_price_cents'
                   and data_type = 'integer') then
    raise exception '029: fair_price_cents not added to listings';
  end if;

  if not exists (select 1 from pg_proc
                 where proname = 'fn_last_fair_price'
                   and pronargs = 1
                   and proargtypes[0] = 'uuid'::regtype) then
    raise exception '029: fn_last_fair_price not created';
  end if;

  raise notice '029 ok: fair_price_cents, fn_last_fair_price';
end $$;

commit;

-- ============================================================================
-- AFTER RUNNING:
--
--   1. Verify:
--      select column_name, data_type from information_schema.columns
--      where table_name = 'listings' and column_name = 'fair_price_cents';
--
--   2. Test fn_last_fair_price:
--      select fn_last_fair_price('some-card-uuid');
--
--   3. Admin approval flow: add fair_price_cents input, pass to listing creation
--   4. Card/Listing display: add fair price rendering
--   5. Relist action: call fn_last_fair_price, pre-fill form
-- ============================================================================