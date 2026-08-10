-- ============================================================
-- FlexSoar — 002_operations.sql
-- Core operations. Every state change goes through one of these.
-- Clients call them by RPC; no table has an INSERT/UPDATE policy.
-- ============================================================
-- Locking rule: any function that moves a card takes
-- `select ... for update` on the card row FIRST. This is what stops
-- double-sells and divergent ownership under concurrency.
-- ============================================================

-- ------------------------------------------------------------
-- HELPERS
-- ------------------------------------------------------------

create or replace function fn_tier_for_price(p_cents integer)
returns smallint language sql stable as $$
  select tier from tier_bands
  where p_cents >= min_cents
    and (max_cents is null or p_cents < max_cents)
  limit 1;
$$;

create or replace function fn_float_multiplier(p_sku uuid, p_float numeric)
returns numeric language sql stable as $$
  select coalesce(
    (select value_multiplier from sku_float_curve
      where sku_id = p_sku and p_float >= float_min and p_float < float_max
      limit 1),
    1.0 - (p_float * 0.48)   -- linear fallback until the oracle fills the curve
  );
$$;

create or replace function fn_card_value_cents(p_card uuid)
returns bigint language sql stable as $$
  select floor(s.market_price_cents * fn_float_multiplier(c.sku_id, c.float_value))::bigint
  from cards c join skus s on s.id = c.sku_id
  where c.id = p_card;
$$;

create or replace function fn_award_xp(
  p_user uuid, p_type text, p_delta integer, p_ref uuid default null)
returns void language plpgsql security definer as $$
begin
  insert into xp_events (user_id, event_type, xp_delta, ref_id)
  values (p_user, p_type, p_delta, p_ref);
  update users set xp_total = xp_total + p_delta where id = p_user;
end $$;

-- ------------------------------------------------------------
-- MINT — item (graded, authenticated) -> card
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

  -- Tier from the SKU's BASE price. Float never promotes rarity.
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

-- Recompute percentile ranks for one SKU. Cheap at low volume; move to a
-- nightly job once a SKU exceeds a few thousand cards.
create or replace function fn_refresh_float_percentiles(p_sku uuid)
returns void language plpgsql security definer as $$
begin
  with ranked as (
    select id, round((percent_rank() over (order by float_value))::numeric * 100, 2) as pct
    from cards where sku_id = p_sku and status <> 'burned'
  )
  update cards c set float_percentile = r.pct
  from ranked r where r.id = c.id;
end $$;

-- ------------------------------------------------------------
-- LISTING
-- ------------------------------------------------------------

create or replace function fn_list_card(
  p_card_id uuid, p_seller_id uuid, p_price_cents integer)
returns uuid language plpgsql security definer as $$
declare
  v_card    cards%rowtype;
  v_minutes smallint;
  v_level   smallint;
  v_oracle  integer;
  v_listing uuid;
begin
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'card % not found', p_card_id; end if;
  if v_card.owner_id <> p_seller_id then
    raise exception 'card % is not owned by %', p_card_id, p_seller_id;
  end if;
  if v_card.status <> 'active' then
    raise exception 'card % is %, expected active', p_card_id, v_card.status;
  end if;

  select u.level, l.early_access_minutes into v_level, v_minutes
  from users u join levels l on l.level = u.level where u.id = p_seller_id;

  v_oracle := fn_card_value_cents(p_card_id);

  insert into listings (card_id, seller_id, price_cents, status,
                        early_access_level, public_at, oracle_value_cents)
  values (p_card_id, p_seller_id, p_price_cents, 'early_access',
          4,  -- Enforcer and above see it during the window
          now() + make_interval(mins => coalesce(v_minutes,0)),
          v_oracle)
  returning id into v_listing;

  update cards set status = 'locked' where id = p_card_id;
  return v_listing;
end $$;

create or replace function fn_cancel_listing(p_listing_id uuid, p_actor uuid)
returns void language plpgsql security definer as $$
declare v_l listings%rowtype;
begin
  select * into v_l from listings where id = p_listing_id for update;
  if v_l.seller_id <> p_actor then raise exception 'not your listing'; end if;
  if v_l.status not in ('early_access','public') then
    raise exception 'listing % is %', p_listing_id, v_l.status;
  end if;
  update listings set status = 'cancelled' where id = p_listing_id;
  update cards set status = 'active' where id = v_l.card_id;
end $$;

-- ------------------------------------------------------------
-- PURCHASE
-- p_settlement_ref is the Stripe payment_intent (or tx hash). Money has
-- ALREADY moved buyer -> seller outside this function. We only record it.
-- ------------------------------------------------------------

create or replace function fn_purchase_card(
  p_listing_id uuid, p_buyer_id uuid, p_settlement_ref text)
returns uuid language plpgsql security definer as $$
declare
  v_l          listings%rowtype;
  v_card       cards%rowtype;
  v_buyer_lvl  smallint;
  v_fee_bps    smallint;
  v_fee        integer;
  v_net        integer;
  v_txn        uuid := gen_random_uuid();
  v_order      uuid;
begin
  select * into v_l from listings where id = p_listing_id for update;
  if not found then raise exception 'listing % not found', p_listing_id; end if;
  if v_l.status not in ('early_access','public') then
    raise exception 'listing % is %', p_listing_id, v_l.status;
  end if;
  if v_l.seller_id = p_buyer_id then
    raise exception 'cannot buy your own listing';
  end if;

  select * into v_card from cards where id = v_l.card_id for update;

  -- Early-access gate
  select level into v_buyer_lvl from users where id = p_buyer_id;
  if now() < v_l.public_at and coalesce(v_buyer_lvl,1) < v_l.early_access_level then
    raise exception 'listing % is in early access until %', p_listing_id, v_l.public_at;
  end if;

  -- Fee comes from the SELLER's level
  select l.seller_fee_bps into v_fee_bps
  from users u join levels l on l.level = u.level where u.id = v_l.seller_id;

  v_fee := floor(v_l.price_cents * v_fee_bps / 10000.0);
  v_net := v_l.price_cents - v_fee;

  insert into orders (listing_id, card_id, buyer_id, seller_id, gross_cents,
                      fee_bps, fee_cents, net_cents, settlement_ref, status, txn_id)
  values (p_listing_id, v_l.card_id, p_buyer_id, v_l.seller_id, v_l.price_cents,
          v_fee_bps, v_fee, v_net, p_settlement_ref, 'settled', v_txn)
  returning id into v_order;

  -- Currency legs (must net to zero)
  insert into ledger_entries (txn_id, entry_type, asset, account_id, is_platform,
                              amount_cents, direction, settlement_ref) values
    (v_txn,'sale_gross','currency', p_buyer_id,  false, v_l.price_cents, -1, p_settlement_ref),
    (v_txn,'sale_net',  'currency', v_l.seller_id,false, v_net,           1, p_settlement_ref),
    (v_txn,'sale_fee',  'currency', null,        true,  v_fee,            1, p_settlement_ref);

  -- Card legs
  insert into ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction) values
    (v_txn,'card_transfer','card', v_l.seller_id, v_l.card_id, -1),
    (v_txn,'card_transfer','card', p_buyer_id,    v_l.card_id,  1);

  -- Ownership cache + provenance
  update cards set owner_id = p_buyer_id, status = 'active' where id = v_l.card_id;

  update card_provenance
     set released_at = now(), price_cents = v_l.price_cents
   where card_id = v_l.card_id and owner_id = v_l.seller_id and released_at is null;

  insert into card_provenance (card_id, owner_id, owner_level, acquired_at, price_cents)
  values (v_l.card_id, p_buyer_id, coalesce(v_buyer_lvl,1), now(), v_l.price_cents);

  update listings set status = 'sold', sold_at = now() where id = p_listing_id;

  perform fn_award_xp(p_buyer_id,  'purchase', greatest(10, v_l.price_cents / 1000), v_order);
  perform fn_award_xp(v_l.seller_id,'sale',     greatest(10, v_l.price_cents / 1000), v_order);

  return v_order;
end $$;

-- ------------------------------------------------------------
-- REDEMPTION — card burns, physical shoe ships
-- ------------------------------------------------------------

create or replace function fn_redeem_card(
  p_card_id uuid, p_user_id uuid, p_address jsonb, p_fee_cents integer)
returns uuid language plpgsql security definer as $$
declare
  v_card cards%rowtype;
  v_txn  uuid := gen_random_uuid();
  v_red  uuid;
begin
  select * into v_card from cards where id = p_card_id for update;
  if v_card.owner_id <> p_user_id then raise exception 'not your card'; end if;
  if v_card.status <> 'active' then
    raise exception 'card % is %, expected active', p_card_id, v_card.status;
  end if;

  update cards set status = 'redeemed' where id = p_card_id;
  update items set status = 'redemption_hold' where id = v_card.item_id;

  insert into ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction)
  values (v_txn,'redemption_burn','card', p_user_id, p_card_id, -1);

  insert into ledger_entries (txn_id, entry_type, asset, account_id, is_platform, amount_cents, direction) values
    (v_txn,'handling_fee','currency', p_user_id, false, p_fee_cents, -1),
    (v_txn,'handling_fee','currency', null,      true,  p_fee_cents,  1);

  insert into redemptions (card_id, item_id, user_id, handling_fee_cents, shipping_address)
  values (p_card_id, v_card.item_id, p_user_id, p_fee_cents, p_address)
  returning id into v_red;

  perform fn_award_xp(p_user_id, 'redemption', 100, v_red);
  return v_red;
end $$;

-- ------------------------------------------------------------
-- CONSIGNMENT STATE MACHINE
-- ------------------------------------------------------------

create or replace function fn_advance_consignment(
  p_id uuid, p_to consignment_status, p_actor uuid, p_note text default null)
returns void language plpgsql security definer as $$
declare
  v_from consignment_status;
  v_ok   boolean;
begin
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
  values (p_id, v_from, p_to, p_actor, p_note);
end $$;

-- ------------------------------------------------------------
-- LEVELS — run nightly
-- rank_score = portfolio_value_cents + (xp_total * 50)
-- ------------------------------------------------------------

create or replace function fn_refresh_levels()
returns integer language plpgsql security definer as $$
declare v_count integer := 0;
begin
  with pv as (
    select u.id as user_id,
           coalesce(sum(fn_card_value_cents(c.id)),0)::bigint as value_cents
    from users u
    left join cards c on c.owner_id = u.id and c.status in ('active','locked')
    group by u.id
  ),
  scored as (
    select pv.user_id, pv.value_cents, u.xp_total, u.level as prev_level,
           (pv.value_cents + (u.xp_total * 50))::bigint as rank_score
    from pv join users u on u.id = pv.user_id
  ),
  levelled as (
    select s.*, (
      select max(l.level) from levels l where l.rank_score_required <= s.rank_score
    ) as new_level
    from scored s
  ),
  snap as (
    insert into level_snapshots
      (user_id, portfolio_value_cents, xp_total, rank_score, level, previous_level)
    select user_id, value_cents, xp_total, rank_score,
           coalesce(new_level,1), prev_level
    from levelled
    returning user_id, level, portfolio_value_cents
  )
  update users u set level = s.level, portfolio_value_cents = s.portfolio_value_cents
  from snap s where s.user_id = u.id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
