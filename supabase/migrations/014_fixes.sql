-- ============================================================
-- FlexSoar — 014_fixes.sql
-- Run in the Supabase SQL editor, "Run without RLS". Single pass.
-- ============================================================
-- Five corrections, four of them defects in 011 and 013.
--
-- 1. LEDGER REJECTS CREDIT. 001's CHECK admits only currency and card
--    rows; 011 added the 'credit' asset without widening it, so every
--    credit insert fails 23514. The credit economy has never worked.
--
-- 2. fn_confirm_shipment FAILS OPEN. The guard read
--    `fulfiller_id is distinct from v_user`. On a WAREHOUSE redemption
--    fulfiller_id is null, and for an anonymous caller v_user is also
--    null, so `null is distinct from null` is false — the guard is
--    skipped entirely and anyone holding the anon key can mark a
--    warehouse parcel shipped. Authorisation now runs before any state
--    is disclosed, and a null session is refused outright.
--
-- 3. fn_purchase_card_with_credit TRUSTED ITS ARGUMENT. It took
--    p_buyer_id without checking it against auth.uid(), so any signed-in
--    user could spend another user's credit balance.
--
-- 4. fn_record_proof WAS DEAD. 013 routed it through fn_set_item_photos,
--    which requires admin and refuses minted items — both wrong for a
--    seller re-photographing a card they are holding.
--
-- 5. fn_mark_shipped WAS SILENTLY WRONG on seller-held rows: it recorded
--    the parcel but never credited fulfilments_completed, the counter
--    that gates cash payout. It now refuses them and points at
--    fn_confirm_shipment.
--
-- Plus fn_list_card finally accepts a payout_method.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ledger admits credit
-- ------------------------------------------------------------

alter table ledger_entries drop constraint if exists ledger_entries_check;
alter table ledger_entries add constraint ledger_entries_check check (
  (asset = 'currency' and amount_cents is not null and card_id is null) or
  (asset = 'credit'   and amount_cents is not null and card_id is null) or
  (asset = 'card'     and card_id is not null and amount_cents is null)
);

-- ------------------------------------------------------------
-- 2. fn_confirm_shipment — authorise first, refuse anonymous
-- ------------------------------------------------------------

create or replace function fn_confirm_shipment(
  p_redemption_id uuid, p_carrier text, p_tracking text)
returns void language plpgsql security definer as $$
declare
  v_red   redemptions%rowtype;
  v_user  uuid;
  v_admin boolean;
begin
  select id into v_user from users where auth_id = auth.uid();
  v_admin := fn_is_admin();
  if v_user is null and not v_admin then
    raise exception 'sign in to confirm a shipment';
  end if;

  select * into v_red from redemptions where id = p_redemption_id for update;
  if not found then raise exception 'redemption % not found', p_redemption_id; end if;

  -- Authorisation BEFORE any state is disclosed.
  if not v_admin then
    if v_red.fulfiller_id is null then
      raise exception 'redemption % is fulfilled by FlexSoar', p_redemption_id;
    end if;
    if v_red.fulfiller_id <> v_user then
      raise exception 'only the holder of this item can confirm shipment';
    end if;
  end if;

  if v_red.status = 'shipped' then
    raise exception 'redemption % is already shipped', p_redemption_id;
  end if;
  if coalesce(p_carrier, '') = '' or coalesce(p_tracking, '') = '' then
    raise exception 'carrier and tracking are both required';
  end if;

  update redemptions set
    status = 'shipped', carrier = p_carrier,
    tracking_number = p_tracking, shipped_at = now()
  where id = p_redemption_id;

  update items set status = 'shipped' where id = v_red.item_id;

  if v_red.fulfiller_id is not null then
    update users set fulfilments_completed = fulfilments_completed + 1
    where id = v_red.fulfiller_id;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. fn_mark_shipped — warehouse only
-- ------------------------------------------------------------

create or replace function fn_mark_shipped(
  p_redemption_id uuid, p_carrier text, p_tracking text)
returns void language plpgsql security definer as $$
declare v_red redemptions%rowtype;
begin
  perform fn_require_admin();

  select * into v_red from redemptions where id = p_redemption_id for update;
  if not found then raise exception 'redemption % not found', p_redemption_id; end if;

  -- Seller-held parcels must go through fn_confirm_shipment, which is
  -- what credits the seller's fulfilment count.
  if v_red.fulfiller_id is not null then
    raise exception
      'redemption % is seller-held; use fn_confirm_shipment', p_redemption_id;
  end if;

  if v_red.status = 'shipped' then
    raise exception 'redemption % is already shipped', p_redemption_id;
  end if;

  update redemptions set
    status = 'shipped', carrier = p_carrier,
    tracking_number = p_tracking, shipped_at = now()
  where id = p_redemption_id;

  update items set status = 'shipped' where id = v_red.item_id;
end $$;

-- ------------------------------------------------------------
-- 4. fn_record_proof — seller-callable, works after mint
-- ------------------------------------------------------------

create or replace function fn_record_proof(p_item_id uuid, p_photos jsonb)
returns void language plpgsql security definer as $$
declare
  v_user uuid;
  v_item items%rowtype;
  v_url  text;
begin
  select id into v_user from users where auth_id = auth.uid();
  if v_user is null then raise exception 'sign in to record proof'; end if;

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;
  if v_item.custody <> 'seller' then
    raise exception 'item % is not seller-held', p_item_id;
  end if;
  if v_item.custody_holder_id is distinct from v_user then
    raise exception 'you are not holding this item';
  end if;

  if jsonb_typeof(p_photos) <> 'array' then
    raise exception 'photos must be a JSON array, got %', jsonb_typeof(p_photos);
  end if;
  if jsonb_array_length(p_photos) < 1 then
    raise exception 'at least one photo is required';
  end if;
  if jsonb_array_length(p_photos) > 24 then
    raise exception 'at most 24 photos per item, got %', jsonb_array_length(p_photos);
  end if;
  for v_url in select jsonb_array_elements_text(p_photos) loop
    if v_url !~ '^https://' then
      raise exception 'photo entries must be https URLs, got %', v_url;
    end if;
  end loop;

  -- Deliberately not routed through fn_set_item_photos: that one is an
  -- admin grading-evidence path and freezes at mint. Proof of possession
  -- is the opposite — it only matters after mint, and only the seller
  -- can produce it.
  update items set photos = p_photos, last_proof_at = now()
  where id = p_item_id;
end $$;

-- ------------------------------------------------------------
-- 5. fn_purchase_card_with_credit — spend only your own balance
-- ------------------------------------------------------------

create or replace function fn_purchase_card_with_credit(
  p_listing_id uuid, p_buyer_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_l         listings%rowtype;
  v_card      cards%rowtype;
  v_buyer_lvl smallint;
  v_fee_bps   smallint;
  v_fee       bigint;
  v_bonus     bigint;
  v_net       bigint;
  v_platform  bigint;
  v_balance   bigint;
  v_txn       uuid := gen_random_uuid();
  v_order     uuid;
begin
  -- The argument is not trusted. Without this, any signed-in user could
  -- spend anyone else's credit.
  if p_buyer_id is distinct from fn_current_user_id() then
    raise exception 'you can only spend your own credit';
  end if;

  if coalesce(fn_config_bool('credit_payout_enabled'), false) is not true then
    raise exception 'credit settlement is disabled';
  end if;

  select * into v_l from listings where id = p_listing_id for update;
  if not found then raise exception 'listing % not found', p_listing_id; end if;
  if v_l.status not in ('early_access', 'public') then
    raise exception 'listing % is %', p_listing_id, v_l.status;
  end if;
  if v_l.payout_method not in ('credit', 'either') then
    raise exception 'listing % settles in cash and cannot be bought with credit',
      p_listing_id;
  end if;
  if v_l.seller_id = p_buyer_id then
    raise exception 'cannot buy your own listing';
  end if;

  select * into v_card from cards where id = v_l.card_id for update;

  select level into v_buyer_lvl from users where id = p_buyer_id;
  if now() < v_l.public_at and coalesce(v_buyer_lvl, 1) < v_l.early_access_level then
    raise exception 'listing % is in early access until %', p_listing_id, v_l.public_at;
  end if;

  v_balance := fn_credit_balance(p_buyer_id);
  if v_balance < v_l.price_cents then
    raise exception 'insufficient credit: balance %, price %', v_balance, v_l.price_cents;
  end if;

  select l.seller_fee_bps into v_fee_bps
  from users u join levels l on l.level = u.level where u.id = v_l.seller_id;

  v_fee      := floor(v_l.price_cents * v_fee_bps / 10000.0);
  v_bonus    := floor(v_l.price_cents
                      * coalesce(fn_config_num('credit_payout_premium_bps'), 0) / 10000.0);
  v_net      := v_l.price_cents - v_fee + v_bonus;
  v_platform := v_l.price_cents - v_net;

  insert into orders (listing_id, card_id, buyer_id, seller_id, gross_cents,
                      fee_bps, fee_cents, net_cents, settlement_ref, status, txn_id)
  values (p_listing_id, v_l.card_id, p_buyer_id, v_l.seller_id, v_l.price_cents,
          v_fee_bps, v_fee, v_net, 'credit:' || v_txn::text, 'settled', v_txn)
  returning id into v_order;

  insert into ledger_entries
    (txn_id, entry_type, asset, account_id, is_platform, amount_cents, direction) values
    (v_txn, 'credit_sale_gross', 'credit', p_buyer_id,    false, v_l.price_cents, -1),
    (v_txn, 'credit_sale_net',   'credit', v_l.seller_id, false, v_net,            1),
    (v_txn, 'credit_sale_fee',   'credit', null,          true,  abs(v_platform),
       case when v_platform >= 0 then 1 else -1 end);

  insert into ledger_entries
    (txn_id, entry_type, asset, account_id, card_id, direction) values
    (v_txn, 'card_transfer', 'card', v_l.seller_id, v_l.card_id, -1),
    (v_txn, 'card_transfer', 'card', p_buyer_id,    v_l.card_id,  1);

  update cards set owner_id = p_buyer_id, status = 'active' where id = v_l.card_id;

  update card_provenance
     set released_at = now(), price_cents = v_l.price_cents
   where card_id = v_l.card_id and owner_id = v_l.seller_id and released_at is null;

  insert into card_provenance (card_id, owner_id, owner_level, acquired_at, price_cents)
  values (v_l.card_id, p_buyer_id, coalesce(v_buyer_lvl, 1), now(), v_l.price_cents);

  update listings set status = 'sold', sold_at = now() where id = p_listing_id;

  perform fn_award_xp(p_buyer_id,    'purchase', greatest(10, v_l.price_cents / 1000), v_order);
  perform fn_award_xp(v_l.seller_id, 'sale',     greatest(10, v_l.price_cents / 1000), v_order);

  return v_order;
end $$;

-- ------------------------------------------------------------
-- 6. fn_list_card accepts a payout method
--    The old 3-arg form is dropped rather than overloaded: a defaulted
--    4th argument would make every 3-arg call ambiguous.
-- ------------------------------------------------------------

drop function if exists fn_list_card(uuid, uuid, integer);

create or replace function fn_list_card(
  p_card_id uuid, p_seller_id uuid, p_price_cents integer,
  p_payout payout_method default 'cash')
returns uuid language plpgsql security definer as $$
declare
  v_card    cards%rowtype;
  v_minutes smallint;
  v_level   smallint;
  v_oracle  integer;
  v_listing uuid;
  v_min     bigint;
  v_ful     integer;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'card % not found', p_card_id; end if;
  if v_card.owner_id <> p_seller_id then
    raise exception 'card % is not owned by %', p_card_id, p_seller_id;
  end if;
  if v_card.status <> 'active' then
    raise exception 'card % is %, expected active', p_card_id, v_card.status;
  end if;

  -- Same gate as fn_submit_listing: cash settlement is uncollateralised
  -- until a seller has shipped a couple of times.
  if p_payout in ('cash', 'either') then
    v_min := coalesce(fn_config_num('cash_payout_min_fulfilments'), 0);
    select fulfilments_completed into v_ful from users where id = p_seller_id;
    if coalesce(v_ful, 0) < v_min then
      raise exception
        'cash settlement needs % completed fulfilments (you have %)',
        v_min, coalesce(v_ful, 0);
    end if;
  end if;

  select u.level, l.early_access_minutes into v_level, v_minutes
  from users u join levels l on l.level = u.level where u.id = p_seller_id;

  v_oracle := fn_card_value_cents(p_card_id);

  insert into listings (card_id, seller_id, price_cents, status,
                        early_access_level, public_at, oracle_value_cents,
                        payout_method)
  values (p_card_id, p_seller_id, p_price_cents, 'early_access',
          4, now() + make_interval(mins => coalesce(v_minutes, 0)), v_oracle, p_payout)
  returning id into v_listing;

  update cards set status = 'locked' where id = p_card_id;
  return v_listing;
end $$;

grant execute on function fn_list_card(uuid, uuid, integer, payout_method)
  to authenticated;
