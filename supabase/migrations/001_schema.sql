-- ============================================================
-- FlexSoar — 001_schema.sql
-- Postgres 15 / Supabase. Run this first, then 002_operations.sql.
-- Supersedes the earlier schema draft.
-- ============================================================
-- Invariants this file enforces at the DB layer (NOT in app code):
--   1. Item (physical) and Card (claim) are separate, strictly 1:1.
--   2. The ledger is append-only and is the source of truth for card
--      custody. cards.owner_id is a cache written in the same txn.
--   3. Currency entries sharing a txn_id must sum to zero.
--   4. No user cash balances exist. Settlement is buyer -> seller direct.
--   5. XP is append-only, non-transferable, never redeemable.
--   6. float_value is graded by a human, copied at mint, then immutable.
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------

create type consignment_status as enum (
  'draft','submitted','in_transit','received','authenticating',
  'authenticated','rejected','return_pending','returned','completed');

create type item_status as enum (
  'pending_intake','in_custody','minted','redemption_hold',
  'shipped','released','returned_to_consignor');

create type card_status as enum ('active','locked','burned','redeemed');

create type listing_status as enum
  ('early_access','public','sold','cancelled','expired');

create type ledger_entry_type as enum (
  'mint','sale_gross','sale_fee','sale_net','card_transfer',
  'trade_up_burn','trade_up_mint','redemption_burn',
  'consignment_fee','subscription_fee','handling_fee');

create type asset_class as enum ('currency','card');

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------

create table users (
  id                    uuid primary key default gen_random_uuid(),
  auth_id               uuid unique,
  handle                citext unique not null,
  email                 citext unique not null,
  country_code          char(2),
  kyc_status            text not null default 'none',
  is_consignor          boolean not null default false,
  is_admin              boolean not null default false,
  -- caches, rewritten by fn_refresh_levels()
  level                 smallint not null default 1,
  xp_total              bigint not null default 0,
  portfolio_value_cents bigint not null default 0,
  created_at            timestamptz not null default now()
);

-- ------------------------------------------------------------
-- CATALOG
-- ------------------------------------------------------------

create table skus (
  id                 uuid primary key default gen_random_uuid(),
  brand              text not null,
  model              text not null,
  colorway           text not null,
  size_us            numeric(4,1) not null,
  retail_price_cents integer,
  market_price_cents integer,             -- oracle output
  price_confidence   numeric(3,2),
  priced_at          timestamptz,
  demand_score       numeric(5,2) not null default 0,
  sprite_key         text,                -- pixel-art base map id
  palette            jsonb,               -- colourway swap for the sprite
  mint_cap           integer,             -- null = uncapped
  created_at         timestamptz not null default now(),
  unique (brand, model, colorway, size_us)
);

create index on skus (demand_score desc);

-- Value multiplier by condition. Oracle writes this per SKU.
create table sku_float_curve (
  sku_id           uuid not null references skus(id) on delete cascade,
  float_min        numeric(4,3) not null,
  float_max        numeric(4,3) not null,
  value_multiplier numeric(4,3) not null,
  primary key (sku_id, float_min)
);

-- Rarity ladder. Tier comes from the SKU's BASE market price,
-- never from float. Float is condition; tier is value.
create table tier_bands (
  tier          smallint primary key check (tier between 1 and 5),
  name          text not null,
  border_color  text not null,
  min_cents     integer not null,
  max_cents     integer          -- null = open ended
);

insert into tier_bands values
  (1,'Common',     '#7A7A7A',      0,   28000),
  (2,'Uncommon',   '#35F07A',  28000,   45000),
  (3,'Rare',       '#3B9EFF',  45000,   85000),
  (4,'Epic',       '#A855F7',  85000,  160000),
  (5,'Legendary',  '#E8B33A', 160000,    null);

-- ------------------------------------------------------------
-- CONSIGNMENT
-- ------------------------------------------------------------

create table consignments (
  id               uuid primary key default gen_random_uuid(),
  consignor_id     uuid not null references users(id),
  status           consignment_status not null default 'draft',
  item_count       smallint not null default 0,
  intake_fee_cents integer not null default 0,
  submitted_at     timestamptz,
  received_at      timestamptz,
  completed_at     timestamptz,
  notes            text,
  created_at       timestamptz not null default now()
);

create table consignment_events (
  id             bigserial primary key,
  consignment_id uuid not null references consignments(id) on delete cascade,
  from_status    consignment_status,
  to_status      consignment_status not null,
  actor_id       uuid references users(id),
  note           text,
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ITEMS — physical truth
-- ------------------------------------------------------------

create table items (
  id                  uuid primary key default gen_random_uuid(),
  sku_id              uuid not null references skus(id),
  consignment_id      uuid references consignments(id),
  consignor_id        uuid references users(id),
  status              item_status not null default 'pending_intake',
  float_value         numeric(4,3) check (float_value between 0 and 1),
  graded_by           uuid references users(id),
  graded_at           timestamptz,
  grading_notes       text,
  photos              jsonb not null default '[]'::jsonb,
  authenticated_at    timestamptz,
  authenticated_by    uuid references users(id),
  custody_location    text,
  reserve_price_cents integer,
  created_at          timestamptz not null default now()
);

create index on items (sku_id, status);
create index on items (consignor_id);

-- ------------------------------------------------------------
-- CARDS
-- ------------------------------------------------------------

create table cards (
  id                 uuid primary key default gen_random_uuid(),
  item_id            uuid unique not null references items(id),
  sku_id             uuid not null references skus(id),
  owner_id           uuid not null references users(id),
  float_value        numeric(4,3) not null,     -- immutable after mint
  tier               smallint not null references tier_bands(tier),
  -- Exceptional is a FLAG, not a tier. Red border overrides the tier
  -- colour while tier keeps driving value bands and trade-up rules.
  is_exceptional     boolean not null default false,
  exceptional_reason text,
  mint_number        integer not null,
  float_percentile   numeric(5,2),
  status             card_status not null default 'active',
  minted_at          timestamptz not null default now(),
  unique (sku_id, mint_number)
);

create index on cards (owner_id) where status in ('active','locked');
create index on cards (sku_id, float_value);

create table card_provenance (
  id          bigserial primary key,
  card_id     uuid not null references cards(id) on delete cascade,
  owner_id    uuid not null references users(id),
  owner_level smallint not null,
  acquired_at timestamptz not null default now(),
  released_at timestamptz,
  price_cents integer
);

create index on card_provenance (card_id, acquired_at);

-- ------------------------------------------------------------
-- LEDGER
-- ------------------------------------------------------------

create table ledger_entries (
  id             bigserial primary key,
  txn_id         uuid not null,
  entry_type     ledger_entry_type not null,
  asset          asset_class not null,
  account_id     uuid references users(id),   -- null = platform
  is_platform    boolean not null default false,
  amount_cents   bigint,
  card_id        uuid references cards(id),
  direction      smallint check (direction in (-1,1)),
  settlement_ref text,
  created_at     timestamptz not null default now(),
  check (
    (asset='currency' and amount_cents is not null and card_id is null) or
    (asset='card'     and card_id is not null and amount_cents is null)
  )
);

create index on ledger_entries (txn_id);
create index on ledger_entries (account_id, created_at desc);
create index on ledger_entries (card_id);

-- Append-only: block updates and deletes outright.
create or replace function trg_ledger_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger_entries is append-only';
end $$;

create trigger ledger_no_update before update or delete on ledger_entries
  for each row execute function trg_ledger_immutable();

-- Currency entries in a txn must net to zero. Deferred so a multi-insert
-- transaction can build the balanced set before the check runs.
create or replace function trg_ledger_balanced() returns trigger
language plpgsql as $$
declare v_sum bigint;
begin
  select coalesce(sum(amount_cents * direction),0) into v_sum
  from ledger_entries
  where txn_id = new.txn_id and asset = 'currency';
  if v_sum <> 0 then
    raise exception 'txn % currency entries do not net to zero (got %)',
      new.txn_id, v_sum;
  end if;
  return null;
end $$;

create constraint trigger ledger_balanced
  after insert on ledger_entries
  deferrable initially deferred
  for each row execute function trg_ledger_balanced();

-- ------------------------------------------------------------
-- MARKETPLACE
-- ------------------------------------------------------------

create table listings (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid not null references cards(id),
  seller_id          uuid not null references users(id),
  price_cents        integer not null check (price_cents > 0),
  status             listing_status not null default 'early_access',
  early_access_level smallint not null default 1,
  public_at          timestamptz not null,
  oracle_value_cents integer,        -- shown to BOTH sides before confirm
  created_at         timestamptz not null default now(),
  sold_at            timestamptz
);

create unique index on listings (card_id)
  where status in ('early_access','public');
create index on listings (status, public_at);
create index on listings (seller_id);

create table orders (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid not null references listings(id),
  card_id        uuid not null references cards(id),
  buyer_id       uuid not null references users(id),
  seller_id      uuid not null references users(id),
  gross_cents    integer not null,
  fee_bps        smallint not null,
  fee_cents      integer not null,
  net_cents      integer not null,
  settlement_ref text,
  status         text not null default 'pending',
  txn_id         uuid,
  created_at     timestamptz not null default now()
);

create index on orders (buyer_id, created_at desc);
create index on orders (seller_id, created_at desc);

-- ------------------------------------------------------------
-- REDEMPTION
-- ------------------------------------------------------------

create table redemptions (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid unique not null references cards(id),
  item_id            uuid not null references items(id),
  user_id            uuid not null references users(id),
  handling_fee_cents integer not null,
  shipping_address   jsonb not null,
  status             text not null default 'requested',
  carrier            text,
  tracking_number    text,
  requested_at       timestamptz not null default now(),
  shipped_at         timestamptz
);

-- ------------------------------------------------------------
-- GAMIFICATION
-- ------------------------------------------------------------

create table xp_events (
  id         bigserial primary key,
  user_id    uuid not null references users(id),
  event_type text not null,
  xp_delta   integer not null,
  ref_id     uuid,
  created_at timestamptz not null default now()
);

create index on xp_events (user_id, created_at desc);

create table levels (
  level                smallint primary key,
  name                 text not null,
  rank_score_required  bigint not null,
  seller_fee_bps       smallint not null,
  early_access_minutes smallint not null default 0,
  max_watchlist_alerts smallint not null default 3,
  trade_up_slots       smallint not null default 0,
  perks                jsonb not null default '{}'::jsonb
);

insert into levels
  (level,name,rank_score_required,seller_fee_bps,early_access_minutes,max_watchlist_alerts,trade_up_slots) values
  (1,'Runner',           0,800, 0,  3, 0),
  (2,'Thug',         10000,750, 2,  5, 1),
  (3,'Hustler',      50000,700, 5, 10, 2),
  (4,'Enforcer',    200000,600,10, 20, 3),
  (5,'Capo',        750000,500,15, 35, 5),
  (6,'Mobster',    2500000,425,20, 60, 8),
  (7,'Underboss',  7500000,350,25,100,12),
  (8,'Mob Boss',  20000000,300,30,999,20);

create table level_snapshots (
  id                    bigserial primary key,
  user_id               uuid not null references users(id),
  portfolio_value_cents bigint not null,
  xp_total              bigint not null,
  rank_score            bigint not null,
  level                 smallint not null,
  previous_level        smallint,
  created_at            timestamptz not null default now()
);

create index on level_snapshots (user_id, created_at desc);

create table subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id),
  plan               text not null,
  status             text not null,
  price_cents        integer not null,
  current_period_end timestamptz,
  provider_ref       text
);

create table watchlists (
  id              bigserial primary key,
  user_id         uuid not null references users(id),
  sku_id          uuid references skus(id),
  max_float       numeric(4,3),
  max_price_cents integer,
  notify          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table referrals (
  id           bigserial primary key,
  referrer_id  uuid not null references users(id),
  referee_id   uuid unique not null references users(id),
  qualified_at timestamptz,
  xp_awarded   integer not null default 0
);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table listings       enable row level security;
alter table cards          enable row level security;
alter table ledger_entries enable row level security;
alter table items          enable row level security;
alter table orders         enable row level security;

create policy listings_visibility on listings for select using (
  status = 'public'
  or public_at <= now()
  or seller_id = auth.uid()
  or early_access_level <= (select level from users where auth_id = auth.uid())
);

create policy cards_public_read on cards for select using (true);

create policy ledger_own_read on ledger_entries for select
  using (account_id = auth.uid());

create policy items_public_read on items for select
  using (status in ('minted','redemption_hold','shipped'));

create policy orders_own_read on orders for select
  using (buyer_id = auth.uid() or seller_id = auth.uid());

-- No INSERT/UPDATE policies anywhere on purpose. All writes go through
-- the SECURITY DEFINER functions in 002_operations.sql.
