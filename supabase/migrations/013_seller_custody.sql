-- ============================================================
-- FlexSoar — 013_seller_custody.sql
-- RUN IN TWO PARTS. Part 1 alone, then Part 2. Both "Run without RLS".
-- ============================================================
-- The pivot: FlexSoar no longer takes physical custody at launch. A
-- seller lists a shoe they keep at home, and whoever holds the card owns
-- the shoe. The seller is a bailee — they hold someone else's property
-- and must ship it on demand.
--
-- Two custody models coexist from day one so the warehouse can arrive
-- later without a rewrite:
--   'seller'    — seller keeps it, self-declared condition
--   'warehouse' — FlexSoar holds it, graded under the rubric (the
--                 existing consignment pipeline, unchanged)
--
-- SELF-DECLARED IS NOT FLEXSOAR-GRADED, and items.grade_source records
-- which it is. Never render them identically: a buyer must be able to
-- tell a measured float from a claimed one.
--
-- Default risk: exposure is the card's value AT REDEMPTION, not at sale,
-- and it grows the longer a card trades before anyone claims the shoe.
-- Credit settlement is the collateral — a seller paid in FSC still has
-- the value inside the system, so a default can be clawed back. Cash
-- settlement cannot. Hence fn_submit_listing defaults to credit and
-- gates cash behind a completed-fulfilment count.
-- ============================================================


-- ============================================================
-- PART 1 — run alone, first.
-- ============================================================

alter type item_status add value if not exists 'pending_review';
alter type item_status add value if not exists 'awaiting_seller_shipment';


-- ============================================================
-- PART 2 — run after PART 1 commits.
-- ============================================================

do $$ begin
  create type custody_model as enum ('warehouse', 'seller');
exception when duplicate_object then null; end $$;

do $$ begin
  create type grade_source as enum ('flexsoar', 'seller_declared');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 1. Custody on items
-- ------------------------------------------------------------

alter table items
  add column if not exists custody           custody_model not null default 'warehouse',
  add column if not exists custody_holder_id uuid references users(id),
  add column if not exists grade_source      grade_source  not null default 'flexsoar',
  add column if not exists asking_price_cents integer,
  add column if not exists submitted_payout  payout_method not null default 'credit',
  add column if not exists last_proof_at     timestamptz;

create index if not exists items_custody_holder on items (custody_holder_id)
  where custody = 'seller';

-- ------------------------------------------------------------
-- 2. Seller trust
-- ------------------------------------------------------------

alter table users
  add column if not exists fulfilments_completed integer not null default 0,
  add column if not exists defaults_count        integer not null default 0,
  add column if not exists is_restricted         boolean not null default false;

insert into platform_config (key, num_value, bool_value, note) values
  ('cash_payout_min_fulfilments', 2, null,
   'Completed fulfilments a seller-held listing requires before cash settlement is offered. Credit is self-collateralising; cash is not.'),
  ('seller_shipment_days', 7, null,
   'Days a seller has to ship after a redemption is requested.'),
  ('proof_of_possession_days', 90, null,
   'How often a seller must re-photograph a held item.')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3. Seller submits a listing — the front door
--    Creates the item only. Nothing is live until an admin reviews the
--    photos and attaches the pixel art; that review is the fraud gate.
-- ------------------------------------------------------------

create or replace function fn_submit_listing(
  p_sku_id       uuid,
  p_price_cents  integer,
  p_payout       payout_method,
  p_photos       jsonb,
  p_outsole      numeric(3,2),
  p_midsole      numeric(3,2),
  p_creasing     numeric(3,2),
  p_upper        numeric(3,2),
  p_heel         numeric(3,2),
  p_accessories  numeric(3,2),
  p_notes        text default null)
returns uuid language plpgsql security definer as $$
declare
  v_user  uuid;
  v_row   users%rowtype;
  v_float numeric(4,3);
  v_url   text;
  v_item  uuid;
  v_min   bigint;
begin
  select id into v_user from users where auth_id = auth.uid();
  if v_user is null then raise exception 'sign in to list an item'; end if;

  select * into v_row from users where id = v_user;
  if v_row.is_restricted then
    raise exception 'this account cannot list items';
  end if;

  if p_price_cents is null or p_price_cents <= 0 then
    raise exception 'price must be positive';
  end if;

  -- Cash settlement is gated: an unproven seller paid in cash is an
  -- uncollateralised loss if they never ship.
  v_min := coalesce(fn_config_num('cash_payout_min_fulfilments'), 0);
  if p_payout in ('cash', 'either') and v_row.fulfilments_completed < v_min then
    raise exception
      'cash settlement needs % completed fulfilments (you have %); list for credit first',
      v_min, v_row.fulfilments_completed;
  end if;

  if jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) < 4 then
    raise exception 'at least 4 photos are required';
  end if;
  for v_url in select jsonb_array_elements_text(p_photos) loop
    if v_url !~ '^https://' then
      raise exception 'photo entries must be https URLs, got %', v_url;
    end if;
  end loop;

  v_float := round(
      p_outsole * 0.25 + p_midsole * 0.20 + p_creasing    * 0.20 +
      p_upper   * 0.20 + p_heel    * 0.10 + p_accessories * 0.05, 3);

  insert into items (
    sku_id, consignor_id, custody, custody_holder_id, grade_source,
    status, float_value, graded_by, graded_at, grading_notes, photos,
    asking_price_cents, submitted_payout, last_proof_at,
    grade_outsole, grade_midsole, grade_creasing,
    grade_upper, grade_heel, grade_accessories)
  values (
    p_sku_id, v_user, 'seller', v_user, 'seller_declared',
    'pending_review', v_float, v_user, now(), p_notes, p_photos,
    p_price_cents, p_payout, now(),
    p_outsole, p_midsole, p_creasing, p_upper, p_heel, p_accessories)
  returning id into v_item;

  return v_item;
end $$;

grant execute on function fn_submit_listing(
  uuid, integer, payout_method, jsonb,
  numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- 4. Admin approves — mints the card and puts the listing live
-- ------------------------------------------------------------

create or replace function fn_approve_submission(
  p_item_id uuid, p_price_cents integer default null)
returns uuid language plpgsql security definer as $$
declare
  v_admin   uuid;
  v_item    items%rowtype;
  v_card    uuid;
  v_price   integer;
  v_listing uuid;
begin
  v_admin := fn_require_admin();

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;
  if v_item.status <> 'pending_review' then
    raise exception 'item % is %, expected pending_review', p_item_id, v_item.status;
  end if;

  -- FlexSoar has reviewed the submission. For a seller-held item this
  -- attests the review, not physical authentication — grade_source keeps
  -- that distinction honest.
  update items set
    status           = 'in_custody',
    authenticated_by = v_admin,
    authenticated_at = now()
  where id = p_item_id;

  v_card  := fn_mint_card(p_item_id, v_item.consignor_id);
  v_price := coalesce(p_price_cents, v_item.asking_price_cents);

  insert into listings (card_id, seller_id, price_cents, status,
                        early_access_level, public_at, oracle_value_cents,
                        payout_method)
  values (v_card, v_item.consignor_id, v_price, 'public',
          1, now(), fn_card_value_cents(v_card), v_item.submitted_payout)
  returning id into v_listing;

  update cards set status = 'locked' where id = v_card;
  return v_listing;
end $$;

grant execute on function fn_approve_submission(uuid, integer) to authenticated;

create or replace function fn_reject_submission(p_item_id uuid, p_reason text)
returns void language plpgsql security definer as $$
begin
  perform fn_require_admin();
  update items set
    status        = 'returned_to_consignor',
    grading_notes = coalesce(grading_notes || E'\n', '') || 'REJECTED: ' || p_reason
  where id = p_item_id and status = 'pending_review';
  if not found then raise exception 'item % is not pending review', p_item_id; end if;
end $$;

grant execute on function fn_reject_submission(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5. Redemption, routed by custody
--    Seller-held: the seller is put on the hook with a deadline.
--    Warehouse: unchanged.
-- ------------------------------------------------------------

alter table redemptions
  add column if not exists fulfiller_id uuid references users(id),
  add column if not exists due_by       timestamptz,
  add column if not exists defaulted_at timestamptz;

create or replace function fn_redeem_card(
  p_card_id uuid, p_user_id uuid, p_address jsonb, p_fee_cents integer)
returns uuid language plpgsql security definer as $$
declare
  v_card cards%rowtype;
  v_item items%rowtype;
  v_txn  uuid := gen_random_uuid();
  v_red  uuid;
  v_days bigint;
begin
  select * into v_card from cards where id = p_card_id for update;
  if v_card.owner_id <> p_user_id then raise exception 'not your card'; end if;
  if v_card.status <> 'active' then
    raise exception 'card % is %, expected active', p_card_id, v_card.status;
  end if;

  select * into v_item from items where id = v_card.item_id for update;
  v_days := coalesce(fn_config_num('seller_shipment_days'), 7);

  update cards set status = 'redeemed' where id = p_card_id;

  update items set status = case
    when v_item.custody = 'seller' then 'awaiting_seller_shipment'
    else 'redemption_hold' end
  where id = v_item.id;

  insert into ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction)
  values (v_txn,'redemption_burn','card', p_user_id, p_card_id, -1);

  insert into ledger_entries (txn_id, entry_type, asset, account_id, is_platform, amount_cents, direction) values
    (v_txn,'handling_fee','currency', p_user_id, false, p_fee_cents, -1),
    (v_txn,'handling_fee','currency', null,      true,  p_fee_cents,  1);

  insert into redemptions (card_id, item_id, user_id, handling_fee_cents,
                           shipping_address, fulfiller_id, due_by, status)
  values (p_card_id, v_card.item_id, p_user_id, p_fee_cents, p_address,
          case when v_item.custody = 'seller' then v_item.custody_holder_id end,
          case when v_item.custody = 'seller' then now() + make_interval(days => v_days::int) end,
          case when v_item.custody = 'seller' then 'awaiting_seller' else 'requested' end)
  returning id into v_red;

  perform fn_award_xp(p_user_id, 'redemption', 100, v_red);
  return v_red;
end $$;

-- The seller (or an admin) confirms dispatch.
create or replace function fn_confirm_shipment(
  p_redemption_id uuid, p_carrier text, p_tracking text)
returns void language plpgsql security definer as $$
declare
  v_red  redemptions%rowtype;
  v_user uuid;
begin
  select id into v_user from users where auth_id = auth.uid();

  select * into v_red from redemptions where id = p_redemption_id for update;
  if not found then raise exception 'redemption % not found', p_redemption_id; end if;
  if v_red.status = 'shipped' then
    raise exception 'redemption % is already shipped', p_redemption_id;
  end if;
  if v_red.fulfiller_id is distinct from v_user and not fn_is_admin() then
    raise exception 'only the holder of this item can confirm shipment';
  end if;
  if coalesce(p_carrier,'') = '' or coalesce(p_tracking,'') = '' then
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

grant execute on function fn_confirm_shipment(uuid, text, text) to authenticated;

-- Seller never shipped. FlexSoar absorbs the loss; the seller is marked
-- and restricted. Any credit they still hold is the recoverable part —
-- claw it back separately, deliberately, and record why.
create or replace function fn_mark_default(p_redemption_id uuid, p_note text)
returns void language plpgsql security definer as $$
declare v_red redemptions%rowtype;
begin
  perform fn_require_admin();

  select * into v_red from redemptions where id = p_redemption_id for update;
  if not found then raise exception 'redemption % not found', p_redemption_id; end if;
  if v_red.fulfiller_id is null then
    raise exception 'redemption % is warehouse-fulfilled', p_redemption_id;
  end if;

  update redemptions set status = 'defaulted', defaulted_at = now()
  where id = p_redemption_id;

  update users set
    defaults_count = defaults_count + 1,
    is_restricted  = true
  where id = v_red.fulfiller_id;

  update items set
    status        = 'released',
    grading_notes = coalesce(grading_notes || E'\n', '') || 'DEFAULT: ' || p_note
  where id = v_red.item_id;
end $$;

grant execute on function fn_mark_default(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 6. Proof of possession
-- ------------------------------------------------------------

create or replace function fn_record_proof(p_item_id uuid, p_photos jsonb)
returns void language plpgsql security definer as $$
declare
  v_user uuid;
  v_item items%rowtype;
begin
  select id into v_user from users where auth_id = auth.uid();

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;
  if v_item.custody_holder_id is distinct from v_user then
    raise exception 'you are not holding this item';
  end if;

  perform fn_set_item_photos(p_item_id, p_photos);
  update items set last_proof_at = now() where id = p_item_id;
end $$;

grant execute on function fn_record_proof(uuid, jsonb) to authenticated;

-- Items overdue for proof. Drive a nag from this.
create or replace view items_proof_overdue as
  select i.id, i.custody_holder_id, i.last_proof_at, s.brand, s.model
  from items i join skus s on s.id = i.sku_id
  where i.custody = 'seller'
    and i.status in ('minted', 'in_custody')
    and i.last_proof_at < now()
        - make_interval(days => coalesce(fn_config_num('proof_of_possession_days'), 90)::int);

grant select on items_proof_overdue to authenticated;

-- ------------------------------------------------------------
-- 7. Sellers must be able to see their own submissions pre-mint.
--    009's items policies covered consignors; this covers the
--    self-serve path, which has no consignment row.
-- ------------------------------------------------------------

drop policy if exists items_holder_read on items;
create policy items_holder_read on items for select
  using (custody_holder_id = fn_current_user_id());

-- ------------------------------------------------------------
-- 8. NOT in this migration
--    - fn_set_item_photos refuses minted items, so fn_record_proof
--      only works pre-mint. It needs a proof-specific path that
--      allows photo updates on a minted, seller-held item.
--    - Clawing back credit from a defaulting seller has no function.
--      Deliberate: it should be a considered admin action with a
--      written reason, not a one-click button.
-- ============================================================
