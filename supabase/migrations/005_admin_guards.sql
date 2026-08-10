-- ============================================================
-- FlexSoar — 005_admin_guards.sql
-- Closes the gap 004 opened.
-- Run in the Supabase SQL editor, "Run without RLS".
-- ============================================================
-- 004 revoked execute from `authenticated` on fn_mint_card and
-- fn_advance_consignment, which pushed both onto the service-role key.
-- That key bypasses RLS entirely and the functions asked nothing about
-- the caller, so any Server Action reaching them was an unauthenticated
-- mint button. Next.js middleware does not cover Server Actions, so the
-- /admin route gate was never protection.
--
-- Fix: grant execute back to `authenticated` and check is_admin INSIDE
-- each function against auth.uid(). SECURITY DEFINER still lets them
-- write past RLS; the caller now has to be a real, admin-flagged user.
-- Call these with the SESSION client, not service-role — under
-- service-role auth.uid() is null and the guard will refuse.
--
-- fn_advance_consignment additionally stops trusting its p_actor
-- argument: the audit trail is now written from the session identity,
-- so passing someone else's id can no longer forge history.
-- ============================================================

create or replace function fn_require_admin()
returns uuid language plpgsql stable security definer as $$
declare v_id uuid;
begin
  select id into v_id from users
   where auth_id = auth.uid() and is_admin;
  if v_id is null then
    raise exception 'admin privileges required';
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------
-- fn_mint_card — guard added, body otherwise unchanged from 002
-- ------------------------------------------------------------

create or replace function fn_mint_card(p_item_id uuid, p_owner_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_item   items%rowtype;
  v_sku    skus%rowtype;
  v_card   uuid;
  v_tier   smallint;
  v_mint   integer;
  v_txn    uuid := gen_random_uuid();
  v_level  smallint;
begin
  perform fn_require_admin();

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;
  if v_item.status <> 'in_custody' then
    raise exception 'item % is %, expected in_custody', p_item_id, v_item.status;
  end if;
  if v_item.float_value is null or v_item.graded_at is null then
    raise exception 'item % has no human-assigned float', p_item_id;
  end if;
  if v_item.authenticated_at is null then
    raise exception 'item % is not authenticated', p_item_id;
  end if;

  select * into v_sku from skus where id = v_item.sku_id;
  if v_sku.market_price_cents is null then
    raise exception 'sku % has no oracle price; cannot assign tier', v_sku.id;
  end if;

  select coalesce(max(mint_number),0) + 1 into v_mint
  from cards where sku_id = v_item.sku_id;

  if v_sku.mint_cap is not null and v_mint > v_sku.mint_cap then
    raise exception 'sku % mint cap of % reached', v_sku.id, v_sku.mint_cap;
  end if;

  v_tier := fn_tier_for_price(v_sku.market_price_cents);
  select level into v_level from users where id = p_owner_id;

  insert into cards (item_id, sku_id, owner_id, float_value, tier, mint_number)
  values (p_item_id, v_item.sku_id, p_owner_id, v_item.float_value, v_tier, v_mint)
  returning id into v_card;

  insert into card_provenance (card_id, owner_id, owner_level, acquired_at)
  values (v_card, p_owner_id, coalesce(v_level,1), now());

  insert into ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction)
  values (v_txn, 'mint', 'card', p_owner_id, v_card, 1);

  update items set status = 'minted' where id = p_item_id;

  perform fn_refresh_float_percentiles(v_item.sku_id);
  perform fn_award_xp(p_owner_id, 'mint', 25, v_card);
  return v_card;
end $$;

-- ------------------------------------------------------------
-- fn_advance_consignment — guard added; actor taken from the session,
-- not from the argument. p_actor is kept for signature compatibility
-- (the contract is frozen) but is ignored.
-- ------------------------------------------------------------

create or replace function fn_advance_consignment(
  p_id uuid, p_to consignment_status, p_actor uuid, p_note text default null)
returns void language plpgsql security definer as $$
declare
  v_from  consignment_status;
  v_ok    boolean;
  v_actor uuid;
begin
  v_actor := fn_require_admin();

  select status into v_from from consignments where id = p_id for update;
  if not found then raise exception 'consignment % not found', p_id; end if;

  v_ok := case v_from
    when 'draft'          then p_to = 'submitted'
    when 'submitted'      then p_to in ('in_transit','draft')
    when 'in_transit'     then p_to = 'received'
    when 'received'       then p_to = 'authenticating'
    when 'authenticating' then p_to in ('authenticated','rejected')
    when 'authenticated'  then p_to = 'completed'
    when 'rejected'       then p_to = 'return_pending'
    when 'return_pending' then p_to = 'returned'
    else false
  end;

  if not v_ok then
    raise exception 'illegal consignment transition % -> %', v_from, p_to;
  end if;

  update consignments set
    status       = p_to,
    submitted_at = case when p_to='submitted' then now() else submitted_at end,
    received_at  = case when p_to='received'  then now() else received_at  end,
    completed_at = case when p_to='completed' then now() else completed_at end
  where id = p_id;

  insert into consignment_events (consignment_id, from_status, to_status, actor_id, note)
  values (p_id, v_from, p_to, v_actor, p_note);
end $$;

-- ------------------------------------------------------------
-- Re-grant. CREATE OR REPLACE preserves privileges, so this is what
-- actually undoes 004's revoke for these two.
-- ------------------------------------------------------------

grant execute on function fn_mint_card(uuid, uuid) to authenticated;
grant execute on function fn_advance_consignment(uuid, consignment_status, uuid, text)
  to authenticated;

-- fn_purchase_card stays service-role only: the Stripe webhook has no
-- user session, so there is no auth.uid() to check. Its only caller is
-- server-side code holding the service key.
