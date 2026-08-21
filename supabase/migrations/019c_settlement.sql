-- 019c_settlement.sql
--
-- RUN 019a AND 019b FIRST.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- The old code treats "how the buyer pays" and "how the seller is paid" as one
-- axis. fn_purchase_card_core refuses any listing whose payout_method is
-- 'credit', and fn_purchase_card_with_credit refuses any listing whose
-- payout_method is 'cash'. That was coherent when payout was a seller's
-- election. It is wrong now, and wrong in the direction that breaks the
-- product: under geography-derived payout, every non-Malaysian seller's
-- listing carries payout_method = 'credit', so the cash path would refuse to
-- sell it - to anyone, ever - while the credit path would only sell it to
-- someone who already holds FSC.
--
-- They are two independent axes:
--
--                        seller receives CASH      seller receives FSC
--                        (Malaysian)               (everyone else)
--   buyer pays CASH      money passes through      pool grows, FSC issued
--   buyer pays FSC       pool drains, FSC burned   FSC changes hands
--   buyer pays BOTH      partial of the above      partial of the above
--
-- All six cells are valid. One function handles all of them, because a
-- cash-only purchase is just a split with zero credit and a credit-only
-- purchase is a split with zero cash. Splitting the code by settlement type is
-- what produced the backwards guard in the first place.
--
-- ---------------------------------------------------------------------------
-- THE ARITHMETIC
-- ---------------------------------------------------------------------------
-- Per transaction, each asset class nets to zero (016's constraint). Given
-- price P, fee F, net N = P - F, buyer credit C and buyer cash H = P - C:
--
--   platform currency = H - (N if seller takes cash else 0)
--   platform credit   = C - (N if seller takes FSC  else 0)
--
-- Worked at P=500, F=35, N=465:
--
--   cash buyer,  cash seller:  currency +35,  credit    0   pool flat, earn 35
--   cash buyer,  FSC seller:   currency +500, credit -465   pool +500, owe 465
--   FSC buyer,   cash seller:  currency -465, credit +500   pool -465, owe -500
--   FSC buyer,   FSC seller:   currency    0, credit  +35   pool flat, owe -35
--   split 100/400, FSC seller: currency +100, credit  -65   pool +100, owe 65
--
-- In every case, platform currency balance minus credit liability equals 35 -
-- the commission, and nothing else. That identity is what 020's sweep view is
-- built on, and it is why the platform needs only one balancing entry per
-- asset rather than separate fee and pool entries.
--
-- Commission is therefore charged on every ownership transfer regardless of
-- what either side settles in. The old credit path took its cut only after
-- subtracting a premium that could exceed it.
--
-- Safe to re-run.

begin;

-- 1. Order columns ----------------------------------------------------------

alter table orders add column if not exists credit_cents     bigint not null default 0;
alter table orders add column if not exists cash_cents       bigint not null default 0;
alter table orders add column if not exists seller_payout    payout_method;
alter table orders add column if not exists payout_release_at timestamptz;

comment on column orders.credit_cents is
  'Portion of the price settled in FSC by the buyer.';
comment on column orders.cash_cents is
  'Portion settled through Stripe. credit_cents + cash_cents = gross_cents.';
comment on column orders.seller_payout is
  'Derived at purchase time from the seller''s country, never elected.';
comment on column orders.payout_release_at is
  'Cash payouts are withheld until this timestamp. The window exists so a '
  'buyer chargeback has a chance to land before the money leaves.';


-- 2. Unified settlement core ------------------------------------------------

create or replace function fn_purchase_card_core(
  p_listing_id    uuid,
  p_buyer_id      uuid,
  p_settlement_ref text,
  p_credit_cents  bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_l           listings%rowtype;
  v_card        cards%rowtype;
  v_buyer_lvl   smallint;
  v_fee_bps     smallint;
  v_price       bigint;
  v_fee         bigint;
  v_net         bigint;
  v_credit      bigint;
  v_cash        bigint;
  v_balance     bigint;
  v_payout      payout_method;
  v_seller_cash boolean;
  v_pf_currency bigint;
  v_pf_credit   bigint;
  v_ref         text;
  v_hold_days   bigint;
  v_txn         uuid := gen_random_uuid();
  v_order       uuid;
begin
  select * into v_l from listings where id = p_listing_id for update;
  if not found then
    raise exception 'listing % not found', p_listing_id;
  end if;
  if v_l.status not in ('early_access','public') then
    raise exception 'listing % is %', p_listing_id, v_l.status;
  end if;
  if v_l.seller_id = p_buyer_id then
    raise exception 'cannot buy your own listing';
  end if;

  select * into v_card from cards where id = v_l.card_id for update;

  select level into v_buyer_lvl from users where id = p_buyer_id;
  if now() < v_l.public_at and coalesce(v_buyer_lvl,1) < v_l.early_access_level then
    raise exception 'listing % is in early access until %', p_listing_id, v_l.public_at;
  end if;

  -- Serialise this buyer so two concurrent purchases cannot both pass the
  -- balance check and spend the same FSC.
  perform 1 from users where id = p_buyer_id for update;

  v_price  := v_l.price_cents;
  v_credit := greatest(coalesce(p_credit_cents, 0), 0);

  if v_credit > v_price then
    v_credit := v_price;
  end if;

  if v_credit > 0 then
    if coalesce(fn_config_bool('credit_payout_enabled'), false) is not true then
      raise exception 'FSC settlement is disabled';
    end if;
    v_balance := fn_credit_balance(p_buyer_id);
    if v_balance < v_credit then
      raise exception 'insufficient FSC: balance %, requested %', v_balance, v_credit;
    end if;
  end if;

  v_cash := v_price - v_credit;

  -- A cash leg without a settlement reference means no money was actually
  -- taken. Refusing here is what stops a client calling this directly and
  -- awarding itself a card.
  if v_cash > 0 and coalesce(btrim(p_settlement_ref), '') = '' then
    raise exception 'a cash leg of % cents requires a settlement_ref', v_cash;
  end if;

  v_ref := coalesce(nullif(btrim(p_settlement_ref), ''), 'fsc:' || v_txn::text);

  -- Payout is a fact about the seller, not a choice. Never read
  -- listings.payout_method here: it is a cached display value and a stale row
  -- must not be able to route real money.
  v_payout      := fn_payout_method_for_user(v_l.seller_id);
  v_seller_cash := (v_payout = 'cash');

  select l.seller_fee_bps into v_fee_bps
  from users u join levels l on l.level = u.level
  where u.id = v_l.seller_id;

  v_fee := floor(v_price * coalesce(v_fee_bps, 0) / 10000.0);
  v_net := v_price - v_fee;

  v_pf_currency := v_cash   - (case when v_seller_cash then v_net else 0 end);
  v_pf_credit   := v_credit - (case when v_seller_cash then 0 else v_net end);

  v_hold_days := coalesce(fn_config_num('payout_hold_days'), 7);

  insert into orders (listing_id, card_id, buyer_id, seller_id, gross_cents,
                      fee_bps, fee_cents, net_cents, settlement_ref, status, txn_id,
                      credit_cents, cash_cents, seller_payout, payout_release_at)
  values (p_listing_id, v_l.card_id, p_buyer_id, v_l.seller_id, v_price,
          v_fee_bps, v_fee, v_net, v_ref, 'settled', v_txn,
          v_credit, v_cash, v_payout,
          case when v_seller_cash
               then now() + make_interval(days => v_hold_days::int)
          end)
  returning id into v_order;

  -- Currency leg -----------------------------------------------------------
  if v_cash > 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction, settlement_ref)
    values (v_txn,'sale_gross','currency', p_buyer_id, false, v_cash, -1, v_ref);
  end if;

  if v_seller_cash then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction, settlement_ref)
    values (v_txn,'sale_net','currency', v_l.seller_id, false, v_net, 1, v_ref);
  end if;

  if v_pf_currency <> 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction, settlement_ref)
    values (v_txn,'sale_fee','currency', null, true,
            abs(v_pf_currency), sign(v_pf_currency)::smallint, v_ref);
  end if;

  -- Credit leg -------------------------------------------------------------
  if v_credit > 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn,'credit_sale_gross','credit', p_buyer_id, false, v_credit, -1);
  end if;

  if not v_seller_cash then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn,'credit_sale_net','credit', v_l.seller_id, false, v_net, 1);
  end if;

  if v_pf_credit <> 0 then
    insert into ledger_entries (txn_id, entry_type, asset, account_id,
                                is_platform, amount_cents, direction)
    values (v_txn,'credit_sale_fee','credit', null, true,
            abs(v_pf_credit), sign(v_pf_credit)::smallint);
  end if;

  -- Card leg ---------------------------------------------------------------
  insert into ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction)
  values (v_txn,'card_transfer','card', v_l.seller_id, v_l.card_id, -1),
         (v_txn,'card_transfer','card', p_buyer_id,    v_l.card_id,  1);

  update cards set owner_id = p_buyer_id, status = 'active' where id = v_l.card_id;

  update card_provenance
     set released_at = now(), price_cents = v_price
   where card_id = v_l.card_id and owner_id = v_l.seller_id and released_at is null;

  insert into card_provenance (card_id, owner_id, owner_level, acquired_at, price_cents)
  values (v_l.card_id, p_buyer_id, coalesce(v_buyer_lvl,1), now(), v_price);

  update listings set status = 'sold', sold_at = now() where id = p_listing_id;

  perform fn_award_xp(p_buyer_id,    'purchase', greatest(10, (v_price / 1000)::int), v_order);
  perform fn_award_xp(v_l.seller_id, 'sale',     greatest(10, (v_price / 1000)::int), v_order);

  return v_order;
end
$function$;

comment on function fn_purchase_card_core(uuid, uuid, text, bigint) is
  'Single settlement path. p_credit_cents is the portion the buyer pays in '
  'FSC; the remainder is cash and requires a settlement_ref. Seller payout is '
  'derived from country, never read from listings.payout_method.';


-- 3. Idempotent entry point -------------------------------------------------

create or replace function fn_purchase_card(
  p_listing_id    uuid,
  p_buyer_id      uuid,
  p_settlement_ref text,
  p_credit_cents  bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing uuid;
begin
  if p_settlement_ref is not null then
    select id into v_existing from orders where settlement_ref = p_settlement_ref;
    if found then
      return v_existing;
    end if;
  end if;

  return fn_purchase_card_core(p_listing_id, p_buyer_id, p_settlement_ref, p_credit_cents);

exception
  when unique_violation then
    select id into v_existing from orders where settlement_ref = p_settlement_ref;
    if v_existing is null then
      raise;
    end if;
    return v_existing;
end;
$function$;


-- 4. Legacy credit entry point ----------------------------------------------
-- Kept so existing callers do not break. Pays the whole price in FSC.

create or replace function fn_purchase_card_with_credit(p_listing_id uuid, p_buyer_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_price bigint;
begin
  select price_cents into v_price from listings where id = p_listing_id;
  if v_price is null then
    raise exception 'listing % not found', p_listing_id;
  end if;
  return fn_purchase_card_core(p_listing_id, p_buyer_id, null, v_price);
end;
$function$;

comment on function fn_purchase_card_with_credit(uuid, uuid) is
  'Thin wrapper over fn_purchase_card_core with p_credit_cents = full price. '
  'The old body applied credit_payout_premium_bps to the seller net and let '
  'platform margin go negative above level 5, minting uncollateralised FSC.';


-- 5. Listing sets payout from geography -------------------------------------

create or replace function fn_list_card(p_card_id uuid, p_seller_id uuid, p_price_cents integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Previously omitted, so payout_method fell to its 'cash' default on every
  -- relist regardless of the original submission.
  insert into listings (card_id, seller_id, price_cents, status,
                        early_access_level, public_at, oracle_value_cents,
                        payout_method)
  values (p_card_id, p_seller_id, p_price_cents, 'early_access',
          4,
          now() + make_interval(mins => coalesce(v_minutes,0)),
          v_oracle,
          fn_payout_method_for_user(p_seller_id))
  returning id into v_listing;

  update cards set status = 'locked' where id = p_card_id;
  return v_listing;
end
$function$;


-- 6. Submission stops asking ------------------------------------------------
-- p_payout is retained in the signature so the frozen contract and existing
-- callers keep working, but it is ignored.

create or replace function fn_submit_listing(
  p_sku_id uuid, p_price_cents integer, p_payout payout_method, p_photos jsonb,
  p_outsole numeric, p_midsole numeric, p_creasing numeric, p_upper numeric,
  p_heel numeric, p_accessories numeric, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user   uuid;
  v_row    users%rowtype;
  v_float  numeric(4,3);
  v_url    text;
  v_item   uuid;
  v_payout payout_method;
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

  -- The cash_payout_min_fulfilments gate is gone. It rationed cash by trust,
  -- which made sense when credit was self-collateralising and the seller chose.
  -- Payout is now a Stripe corridor fact. An unproven Malaysian seller is still
  -- paid cash - the protection against them is payout_hold_days plus proof of
  -- possession, not a settlement instrument they never picked.
  v_payout := fn_payout_method_for_user(v_user);

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
    p_price_cents, v_payout, now(),
    p_outsole, p_midsole, p_creasing, p_upper, p_heel, p_accessories)
  returning id into v_item;

  return v_item;
end
$function$;


-- 7. Grants -----------------------------------------------------------------

grant execute on function fn_purchase_card(uuid, uuid, text, bigint) to authenticated;
grant execute on function fn_purchase_card_with_credit(uuid, uuid)   to authenticated;
grant execute on function fn_submit_listing(uuid, integer, payout_method, jsonb,
       numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

revoke execute on function fn_purchase_card_core(uuid, uuid, text, bigint) from anon;
revoke execute on function fn_purchase_card_core(uuid, uuid, text, bigint) from authenticated;

commit;
