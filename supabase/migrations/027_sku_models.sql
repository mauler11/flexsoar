-- ============================================================================
-- 027_sku_models.sql
--
-- Size stops being SKU identity and becomes a variant underneath a MODEL.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- `skus` is keyed on (brand, model, colorway, size_us), so "AJ1 Chicago US9"
-- and "US10" are two rows: two oracle prices, two pixel-art assets, two rows
-- toward the metric that is supposed to say whether a real market exists.
--
-- The decisive cost is the art. skus.art_url is per row, and the art workflow
-- is manual (screenshot -> prompt -> generate on Perchance -> pick -> upload).
-- Nothing about a pixel-art sneaker depends on size, so one popular shoe in
-- fifteen sizes is fifteen runs of that loop producing fifteen near-identical
-- images. That compounds against the operator's own hands, not the database.
--
-- Second: fn_trade_quote compares fn_card_value_cents on both sides. Under
-- size-as-identity a US9 <-> US13 trade compares two oracles set independently
-- on two different days. Under a base price plus a size curve it compares two
-- points on one curve.
--
-- Third: the success metric is "SKUs with more than one card". Under
-- size-as-identity that number is structurally incapable of exceeding 1 for
-- most shoes, so it has been measuring an artefact of the schema. It becomes
-- "MODELS with more than one card", which measures something real.
--
-- ---------------------------------------------------------------------------
-- THE SHAPE, AND WHY IT IS NOT "skus splits into two tables"
-- ---------------------------------------------------------------------------
-- `skus` STAYS, and becomes the variant row. Same primary key, same ids. Every
-- FK on cards, items, listings, submissions, watchlists and sku_float_curve is
-- untouched. A new parent table sits above it.
--
--   sku_models  brand + model + colorway. Holds base_price_cents (the ORACLE),
--               and the art: art_url, sprite_key, palette.
--   skus        the variant: model_id + size_us, plus size_multiplier and an
--               optional price_override_cents.
--
-- skus.market_price_cents stays a REAL COLUMN, maintained by trigger as
--   coalesce(price_override_cents, base_price_cents * size_multiplier)
-- so every existing function that reads it — fn_card_value_cents,
-- fn_mint_card's null guard, fn_trade_quote through fn_card_value_cents —
-- keeps working with ZERO edits. Given that 026 and 026b both came from
-- touching things broadly, blast radius is worth more here than purity.
--
-- ---------------------------------------------------------------------------
-- THE ONE BEHAVIOURAL CHANGE: TIER COMES FROM THE MODEL
-- ---------------------------------------------------------------------------
-- Tier is rendered as the border colour on an art asset that is now SHARED
-- across sizes. If a US9 were Rare and a US13 Epic, one sprite would carry two
-- frames, or the badge would contradict the frame. So:
--
--   tier  -> sku_models.base_price_cents   (via fn_tier_for_sku)
--   value -> skus.market_price_cents       (via fn_card_value_cents, unchanged)
--
-- These two read the same column today. fn_mint_card is reissued at the SAME
-- ARITY to split them. With size_multiplier defaulting to 1.000 the two agree
-- for every variant that has no override, so nothing observable changes today.
--
-- ---------------------------------------------------------------------------
-- THE SIZE CURVE SHIPS FLAT, DELIBERATELY
-- ---------------------------------------------------------------------------
-- size_multiplier defaults to 1.000. There is no sales data to calibrate a
-- curve against, and a wrong curve misprices every variant of every model
-- silently. What this migration buys is the STRUCTURE: one pricing decision
-- per model instead of one per size, and a place to put real numbers later.
-- Where a specific size genuinely diverges, set price_override_cents on that
-- variant. Both are admin decisions; neither is a seller's.
--
-- ---------------------------------------------------------------------------
-- BREAKING CHANGE FOR THE APP LAYER — READ THIS
-- ---------------------------------------------------------------------------
-- skus.market_price_cents is now DERIVED. Writing it directly RAISES rather
-- than being silently overwritten, because a silently-ignored price write is
-- exactly the class of bug that produced the orders.fee_cents premium gap.
-- Anything that sets it (upsertSku, the admin SKU bench, seeds) must instead
-- set sku_models.base_price_cents or skus.price_override_cents.
--
-- Likewise fn_replace_sku_art keeps its signature but now writes the MODEL's
-- art and propagates to every size. That is the point; it is also a change in
-- what one call affects.
--
-- ---------------------------------------------------------------------------
-- DEPENDS ON: 001 (skus, cards, tier_bands), 005 (fn_mint_card, fn_require_admin),
--             012 (skus.art_url), 015 (the art guard + GUC pattern),
--             022b (default privileges), 026 (the anon revoke).
--
-- RUN IN: Supabase SQL editor, "Run without RLS". Single pass.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Snapshot, so the assertions at the bottom can prove nothing moved
-- ---------------------------------------------------------------------------
create temporary table _pre_sku on commit drop as
  select id, brand, model, colorway, size_us,
         market_price_cents, art_url, sprite_key, palette
  from skus;

create temporary table _pre_card on commit drop as
  select id, sku_id, tier from cards;

do $$
declare v_n int;
begin
  select count(*) into v_n from _pre_sku;
  raise notice '027: % existing sku row(s) snapshotted', v_n;
  select count(*) into v_n from _pre_card;
  raise notice '027: % existing card row(s) snapshotted', v_n;
end $$;


-- ---------------------------------------------------------------------------
-- 1. The model
--
-- One row per brand + model + colourway. This is the level a human wants to
-- merge duplicates at ("AJ1 Chicago" / "Jordan 1 Chicago" / "Air Jordan 1
-- Retro High OG Chicago" are one model, not three), and the level fuzzy
-- matching should run against — with size stripped out of the string entirely.
--
-- base_price_cents is THE ORACLE. Sellers must never set it: a seller-set
-- oracle lets someone mint a Legendary from nothing and trade it for real
-- inventory. listings.price_cents is the seller's ask and is a different thing.
-- ---------------------------------------------------------------------------
create table if not exists sku_models (
  id               uuid primary key default gen_random_uuid(),
  brand            text not null,
  model            text not null,
  colorway         text not null,
  base_price_cents integer check (base_price_cents is null or base_price_cents > 0),
  price_confidence numeric(3,2),
  priced_at        timestamptz,
  sprite_key       text,
  palette          jsonb,
  art_url          text,
  demand_score     numeric(5,2) not null default 0,
  created_at       timestamptz not null default now(),
  constraint sku_models_identity_uidx unique (brand, model, colorway),
  constraint sku_models_art_url_https
    check (art_url is null or art_url ~ '^https://')
);

comment on table sku_models is
  'Brand + model + colourway. Carries the ORACLE price and the single art '
  'asset shared by every size. skus rows are the size variants beneath it.';

comment on column sku_models.base_price_cents is
  'The oracle. Sets TIER via fn_tier_for_sku and feeds every variant''s '
  'market_price_cents. Null means unpriced: fn_mint_card refuses, so an '
  'unpriced model physically cannot become a card. Admin-set only.';

create index if not exists sku_models_demand_idx
  on sku_models (demand_score desc);

alter table sku_models enable row level security;

drop policy if exists sku_models_read on sku_models;
create policy sku_models_read on sku_models for select using (true);

drop policy if exists sku_models_admin_write on sku_models;
create policy sku_models_admin_write on sku_models for all
  using (fn_is_admin()) with check (fn_is_admin());

grant select                         on sku_models to anon, authenticated;
grant insert, update, delete, select on sku_models to service_role;
-- RLS (sku_models_admin_write) is what actually gates these for a session.
grant insert, update                 on sku_models to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Backfill: one model per distinct identity among existing SKUs
--
-- base_price_cents takes the MAX across the group's sizes. Today every group
-- has one member so that is a no-op, but if a group ever disagreed the higher
-- number is the safer base (a lower variant then carries an explicit override
-- rather than being silently marked up).
-- ---------------------------------------------------------------------------
insert into sku_models (brand, model, colorway, base_price_cents,
                        price_confidence, priced_at, sprite_key, palette,
                        art_url, demand_score)
select s.brand, s.model, s.colorway,
       max(s.market_price_cents),
       max(s.price_confidence),
       max(s.priced_at),
       (array_remove(array_agg(s.sprite_key), null))[1],
       (array_remove(array_agg(s.palette),    null))[1],
       (array_remove(array_agg(s.art_url),    null))[1],
       max(s.demand_score)
from skus s
group by s.brand, s.model, s.colorway
on conflict (brand, model, colorway) do nothing;

-- If two sizes of one shoe carried DIFFERENT art, the aggregate above kept one
-- and the other is about to be overwritten. Say so out loud rather than
-- discovering it when a card re-renders.
do $$
declare v_bad text;
begin
  select string_agg(brand || ' ' || model || ' ' || colorway, '; ') into v_bad
  from (
    select brand, model, colorway
    from skus where art_url is not null
    group by brand, model, colorway
    having count(distinct art_url) > 1
  ) x;
  if v_bad is not null then
    raise notice
      '027 WARNING: these identities had more than one distinct art_url across '
      'sizes; one was kept and the rest will be replaced: %', v_bad;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. Variant columns on skus
-- ---------------------------------------------------------------------------
alter table skus add column if not exists model_id uuid references sku_models(id);

alter table skus add column if not exists size_multiplier numeric(5,3);
alter table skus drop constraint if exists skus_size_multiplier_positive;
alter table skus add constraint skus_size_multiplier_positive
  check (size_multiplier is null or (size_multiplier > 0 and size_multiplier <= 10));

alter table skus add column if not exists price_override_cents integer;
alter table skus drop constraint if exists skus_price_override_positive;
alter table skus add constraint skus_price_override_positive
  check (price_override_cents is null or price_override_cents > 0);

comment on column skus.model_id is
  'The model this size belongs to. brand/model/colorway on this row are a '
  'maintained copy of the model''s — do not write them here.';
comment on column skus.size_multiplier is
  'Size curve point. Ships at 1.000 for everything: there is no sales data to '
  'calibrate against, and a wrong curve misprices silently. Structure now, '
  'numbers later.';
comment on column skus.price_override_cents is
  'Escape hatch for a size that genuinely diverges from base x multiplier. '
  'Wins over the derived value. Admin-set only.';
comment on column skus.market_price_cents is
  'DERIVED as of 027: coalesce(price_override_cents, base_price_cents x '
  'size_multiplier), maintained by trg_sku_variant_derive. Writing it directly '
  'RAISES. Set sku_models.base_price_cents or skus.price_override_cents.';

-- Attach every existing variant, preserving its exact current price. The
-- triggers below do not exist yet, so this UPDATE cannot perturb anything.
update skus s
   set model_id             = m.id,
       size_multiplier      = 1.000,
       price_override_cents = case
         when s.market_price_cents is distinct from m.base_price_cents
           then s.market_price_cents
         else null
       end
from sku_models m
where m.brand    = s.brand
  and m.model    = s.model
  and m.colorway = s.colorway;

alter table skus alter column model_id        set not null;
alter table skus alter column size_multiplier set not null;
alter table skus alter column size_multiplier set default 1.000;

-- The real identity constraint now. The old unique (brand, model, colorway,
-- size_us) is kept: it is redundant given this plus sku_models_identity_uidx,
-- and redundant constraints that agree are cheap insurance.
create unique index if not exists skus_model_size_uidx on skus (model_id, size_us);
create index if not exists skus_model_id_idx on skus (model_id);


-- ---------------------------------------------------------------------------
-- 4. Derivation trigger on the variant
--
-- Fires BEFORE INSERT OR UPDATE. It is the only thing that writes
-- skus.market_price_cents, and it refuses a conflicting value rather than
-- overwriting it quietly — a price write that is ignored without saying so is
-- the same failure mode as an entry type that means two things.
--
-- NOTE ON TRIGGER ORDER: trg_guard_sku_art_url (015) is also BEFORE UPDATE on
-- skus and fires first (Postgres orders by trigger name, and 'trg_guard' <
-- 'trg_sku'). This trigger deliberately does NOT touch art_url on UPDATE for
-- that reason; art propagation is fn_sync_sku_variants' job and carries the
-- 015 GUC bypass.
-- ---------------------------------------------------------------------------
create or replace function trg_sku_variant_derive()
returns trigger
language plpgsql
as $$
declare
  v_m       sku_models%rowtype;
  v_derived integer;
begin
  select * into v_m from sku_models where id = new.model_id;
  if not found then
    raise exception 'sku_model % not found', new.model_id;
  end if;

  -- Identity belongs to the model. These columns are a maintained copy.
  new.brand    := v_m.brand;
  new.model    := v_m.model;
  new.colorway := v_m.colorway;

  new.size_multiplier := coalesce(new.size_multiplier, 1.000);

  v_derived := coalesce(
    new.price_override_cents,
    case when v_m.base_price_cents is null then null
         else floor(v_m.base_price_cents * new.size_multiplier)::integer
    end
  );

  -- Refuse a direct write. On UPDATE, "new = old" means the writer touched
  -- something else and is not asserting a price, so it passes.
  if tg_op = 'INSERT' then
    if new.market_price_cents is distinct from v_derived
       and new.market_price_cents is not null then
      raise exception
        'skus.market_price_cents is derived (%). Set sku_models.base_price_cents '
        'or skus.price_override_cents instead of writing it directly.',
        coalesce(v_derived::text, 'null');
    end if;
  else
    if new.market_price_cents is distinct from old.market_price_cents
       and new.market_price_cents is distinct from v_derived then
      raise exception
        'skus.market_price_cents is derived (%). Set sku_models.base_price_cents '
        'or skus.price_override_cents instead of writing it directly.',
        coalesce(v_derived::text, 'null');
    end if;
  end if;

  new.market_price_cents := v_derived;

  if tg_op = 'INSERT' then
    -- Art and pricing metadata are inherited at birth. On UPDATE they are left
    -- alone; fn_sync_sku_variants pushes model changes down.
    new.art_url          := coalesce(new.art_url,          v_m.art_url);
    new.sprite_key       := coalesce(new.sprite_key,       v_m.sprite_key);
    new.palette          := coalesce(new.palette,          v_m.palette);
    new.price_confidence := coalesce(new.price_confidence, v_m.price_confidence);
    new.priced_at        := coalesce(new.priced_at,        v_m.priced_at);
  end if;

  return new;
end $$;

drop trigger if exists trg_sku_variant_derive on skus;
create trigger trg_sku_variant_derive
  before insert or update on skus
  for each row execute function trg_sku_variant_derive();


-- ---------------------------------------------------------------------------
-- 5. Propagating a model change down to its variants
--
-- Internal. Granted to NO client role — same standing rule as
-- fn_credit_available_unchecked (024c): reachable only from SECURITY DEFINER
-- bodies owned by this role.
--
-- The GUC dance is 015's sanctioned art-replacement bypass, reused rather than
-- reinvented. The previous value is restored rather than hardcoded to 'off',
-- so a nested call cannot switch the guard back on mid-statement.
-- ---------------------------------------------------------------------------
create or replace function fn_sync_sku_variants(p_model_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prev text;
  v_n    integer;
begin
  v_prev := coalesce(current_setting('flexsoar.allow_art_replace', true), 'off');
  perform set_config('flexsoar.allow_art_replace', 'on', true);

  -- market_price_cents is not listed: trg_sku_variant_derive recomputes it on
  -- every UPDATE, which is how a base_price_cents change reaches the variants.
  update skus s
     set art_url          = m.art_url,
         sprite_key       = m.sprite_key,
         palette          = m.palette,
         price_confidence = m.price_confidence,
         priced_at        = m.priced_at
  from sku_models m
  where m.id = s.model_id
    and s.model_id = p_model_id;

  get diagnostics v_n = row_count;

  perform set_config('flexsoar.allow_art_replace', v_prev, true);
  return v_n;
end $$;

comment on function fn_sync_sku_variants(uuid) is
  'INTERNAL. Pushes a model''s art and pricing metadata down to every size '
  'variant and forces a price recompute. Granted to no role.';

revoke execute on function fn_sync_sku_variants(uuid)
  from public, anon, authenticated, service_role;

create or replace function trg_sku_model_propagate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform fn_sync_sku_variants(new.id);
  return null;
end $$;

drop trigger if exists trg_sku_model_propagate on sku_models;
create trigger trg_sku_model_propagate
  after update on sku_models
  for each row when (old.* is distinct from new.*)
  execute function trg_sku_model_propagate();


-- ---------------------------------------------------------------------------
-- 6. The art guard, moved up to the model
--
-- Same rule and the same GUC as 015, one level higher:
--   null  -> value   allowed (first art, the normal path)
--   value -> same    allowed (no-op)
--   value -> other   blocked
--   value -> null    blocked
--
-- 015's trigger on skus is deliberately KEPT as defence against a direct write
-- to a variant. fn_sync_sku_variants is the only sanctioned path through it.
-- ---------------------------------------------------------------------------
create or replace function fn_guard_sku_model_art_url()
returns trigger
language plpgsql
as $$
begin
  if old.art_url is not null
     and coalesce(current_setting('flexsoar.allow_art_replace', true), 'off') <> 'on'
  then
    raise exception
      using errcode = '42501',
            message = format(
              'sku_model %s already has art_url; replacement must go through '
              'fn_replace_sku_art()', old.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_sku_model_art_url on sku_models;
create trigger trg_guard_sku_model_art_url
  before update on sku_models
  for each row when (old.art_url is distinct from new.art_url)
  execute function fn_guard_sku_model_art_url();

-- ---------------------------------------------------------------------------
-- fn_replace_sku_art keeps its (uuid, text) signature and its return type, so
-- lib/api/contract.ts needs no change. What changes is WHAT IT AFFECTS: art is
-- now one asset per model, so this updates every size of that shoe at once.
-- SECURITY INVOKER is preserved on purpose — sku_models_admin_write stays the
-- real gate, exactly as skus_admin_write was.
-- ---------------------------------------------------------------------------
create or replace function fn_replace_sku_art(p_sku_id uuid, p_art_url text)
returns skus
language plpgsql
set search_path = public
as $$
declare
  v_model uuid;
  v_prev  text;
  v_row   skus;
begin
  perform fn_require_admin();

  select model_id into v_model from skus where id = p_sku_id;
  if v_model is null then
    raise exception
      using errcode = 'P0002',
            message = format('sku %s not found, or not yours to update', p_sku_id);
  end if;

  v_prev := coalesce(current_setting('flexsoar.allow_art_replace', true), 'off');
  perform set_config('flexsoar.allow_art_replace', 'on', true);

  update sku_models set art_url = p_art_url where id = v_model;

  perform set_config('flexsoar.allow_art_replace', v_prev, true);

  select * into v_row from skus where id = p_sku_id;
  return v_row;
end $$;

comment on function fn_replace_sku_art(uuid, text) is
  'Deliberate replacement of a MODEL''s pixel art, addressed by any one of its '
  'size variants. Admin session only. Changes the rendered art on every card '
  'of every size of this model — that breadth is the point of 027, and it is '
  'wider than the pre-027 behaviour.';

revoke execute on function fn_replace_sku_art(uuid, text) from public, anon;
grant  execute on function fn_replace_sku_art(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Tier reads the model
-- ---------------------------------------------------------------------------
create or replace function fn_tier_for_sku(p_sku_id uuid)
returns smallint
language sql
stable
as $$
  select fn_tier_for_price(m.base_price_cents)
  from skus s
  join sku_models m on m.id = s.model_id
  where s.id = p_sku_id;
$$;

comment on function fn_tier_for_sku(uuid) is
  'Tier from the MODEL''s base price, not the variant''s. Tier is drawn as the '
  'border on an art asset shared across sizes, so one model must have one '
  'tier. Value stays per-variant via fn_card_value_cents.';

grant execute on function fn_tier_for_sku(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_mint_card — SAME ARITY, one changed line plus its guard.
--
-- Reissued in full because Postgres has no way to patch a body. This is the
-- 005 body verbatim apart from the tier block. CREATE OR REPLACE preserves
-- privileges, so 005's grant to authenticated and 026's revoke both survive.
-- ---------------------------------------------------------------------------
create or replace function fn_mint_card(p_item_id uuid, p_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
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

  -- CHANGED (027): tier is the MODEL's, not the variant's. A size that carries
  -- a price_override must not land in a different rarity band from its
  -- siblings, because they all render the same art asset and border.
  v_tier := fn_tier_for_sku(v_item.sku_id);
  if v_tier is null then
    raise exception
      'sku % belongs to a model with no base price; cannot assign tier', v_sku.id;
  end if;

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


-- ---------------------------------------------------------------------------
-- 8. Write paths
--
-- fn_create_sku_model is ADMIN ONLY: base_price_cents is the oracle, and a
-- seller who can set it can mint a Legendary from nothing and trade it for
-- real inventory.
--
-- fn_ensure_sku_variant is safe for a signed-in seller: the variant's price is
-- DERIVED from the model, so creating one confers no value. A variant under an
-- unpriced model is simply unmintable, which fn_mint_card already enforces.
-- This is what lets the tenth person listing AJ1 Chicago in a new size skip
-- the pricing decision entirely.
--
-- The seller-facing "type your shoe, fuzzy match, create if nothing fits" flow
-- and the duplicate-merge tool are app work and are NOT in this migration.
-- ---------------------------------------------------------------------------
create or replace function fn_create_sku_model(
  p_brand            text,
  p_model            text,
  p_colorway         text,
  p_base_price_cents integer default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_b  text := btrim(coalesce(p_brand, ''));
  v_m  text := btrim(coalesce(p_model, ''));
  v_c  text := btrim(coalesce(p_colorway, ''));
begin
  perform fn_require_admin();

  if v_b = '' or v_m = '' or v_c = '' then
    raise exception 'brand, model and colorway are all required';
  end if;
  if p_base_price_cents is not null and p_base_price_cents <= 0 then
    raise exception 'base price must be positive, got %', p_base_price_cents;
  end if;

  insert into sku_models (brand, model, colorway, base_price_cents,
                          priced_at)
  values (v_b, v_m, v_c, p_base_price_cents,
          case when p_base_price_cents is not null then now() end)
  on conflict (brand, model, colorway) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from sku_models
     where brand = v_b and model = v_m and colorway = v_c;
  end if;

  return v_id;
end $$;

revoke execute on function fn_create_sku_model(text, text, text, integer)
  from public, anon;
grant  execute on function fn_create_sku_model(text, text, text, integer)
  to authenticated;

create or replace function fn_ensure_sku_variant(
  p_model_id uuid,
  p_size_us  numeric
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id   uuid;
  v_size numeric(4,1);
begin
  if fn_current_user_id() is null and
     coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') <> ''
  then
    raise exception 'sign in to add a size';
  end if;

  if not exists (select 1 from sku_models where id = p_model_id) then
    raise exception 'sku_model % not found', p_model_id;
  end if;

  v_size := round(p_size_us::numeric, 1);
  if v_size is null or v_size < 3 or v_size > 20 then
    raise exception 'size % is outside the supported range (3 to 20)', p_size_us;
  end if;
  if (v_size * 2) <> floor(v_size * 2) then
    raise exception 'size % is not a whole or half size', p_size_us;
  end if;

  select id into v_id from skus
   where model_id = p_model_id and size_us = v_size;
  if v_id is not null then
    return v_id;
  end if;

  -- brand/model/colorway are overwritten from the model by
  -- trg_sku_variant_derive; the placeholders below only satisfy NOT NULL.
  begin
    insert into skus (brand, model, colorway, size_us, model_id, size_multiplier)
    values ('', '', '', v_size, p_model_id, 1.000)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from skus
     where model_id = p_model_id and size_us = v_size;
  end;

  return v_id;
end $$;

comment on function fn_ensure_sku_variant(uuid, numeric) is
  'Create-on-demand size variant. Safe for a seller: the price is derived from '
  'the model, so no value is conferred, and an unpriced model stays unmintable.';

revoke execute on function fn_ensure_sku_variant(uuid, numeric) from public, anon;
grant  execute on function fn_ensure_sku_variant(uuid, numeric) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Assertions — fail the migration rather than report a false success
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes  int;
  v_bad    text;
  v_n      int;
begin
  -- 9a. no arity duplicates. The standing check on this project.
  select count(*) into v_dupes from (
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
    group by p.proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '027: % function(s) now have multiple arities', v_dupes;
  end if;

  -- 9b. every variant belongs to exactly one model
  if exists (select 1 from skus where model_id is null) then
    raise exception '027: sku row(s) with no model_id survived the backfill';
  end if;

  -- 9c. NO EXISTING PRICE MOVED. This is the one that matters: 12 cards are
  --     already minted against these numbers.
  select string_agg(
           p.brand || ' ' || p.model || ' ' || p.colorway || ' US' || p.size_us
           || ': ' || coalesce(p.market_price_cents::text,'null')
           || ' -> ' || coalesce(s.market_price_cents::text,'null'), '; ')
    into v_bad
  from _pre_sku p join skus s on s.id = p.id
  where p.market_price_cents is distinct from s.market_price_cents;
  if v_bad is not null then
    raise exception '027: market_price_cents changed on existing sku(s): %', v_bad;
  end if;

  -- 9d. no existing art was lost
  select string_agg(p.id::text, ', ') into v_bad
  from _pre_sku p join skus s on s.id = p.id
  where p.art_url is distinct from s.art_url
     or p.sprite_key is distinct from s.sprite_key;
  if v_bad is not null then
    raise exception '027: art changed on existing sku(s): %', v_bad;
  end if;

  -- 9e. identity survived the model round-trip
  select string_agg(p.id::text, ', ') into v_bad
  from _pre_sku p join skus s on s.id = p.id
  where p.brand    is distinct from s.brand
     or p.model    is distinct from s.model
     or p.colorway is distinct from s.colorway
     or p.size_us  is distinct from s.size_us;
  if v_bad is not null then
    raise exception '027: brand/model/colorway/size changed on sku(s): %', v_bad;
  end if;

  -- 9f. derivation is self-consistent for every row
  select string_agg(s.id::text, ', ') into v_bad
  from skus s join sku_models m on m.id = s.model_id
  where s.market_price_cents is distinct from coalesce(
    s.price_override_cents,
    case when m.base_price_cents is null then null
         else floor(m.base_price_cents * s.size_multiplier)::integer end);
  if v_bad is not null then
    raise exception '027: derived price disagrees with stored on sku(s): %', v_bad;
  end if;

  -- 9g. tier semantics. Stored card tiers are immutable and untouched; what is
  --     checked here is whether the NEW rule would have produced the same
  --     answer. A mismatch is not fatal — it means a group's sizes disagreed on
  --     price and the model took the max — but it must not pass unnoticed.
  select count(*) into v_n
  from cards c
  where c.tier is distinct from fn_tier_for_sku(c.sku_id);
  if v_n > 0 then
    raise notice
      '027 WARNING: % existing card(s) have a stored tier that differs from '
      'the model-derived tier. Their art and border now disagree. Review with: '
      'select c.id, c.tier, fn_tier_for_sku(c.sku_id) from cards c '
      'where c.tier is distinct from fn_tier_for_sku(c.sku_id);', v_n;
  else
    raise notice '027: all existing card tiers agree with the model-derived tier';
  end if;

  -- 9h. the internal sync function is unreachable from every client role
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'),('authenticated'),('service_role')) as r(rolname)
    where n.nspname = 'public'
      and p.proname = 'fn_sync_sku_variants'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  ) then
    raise exception
      '027: fn_sync_sku_variants is callable by a client role — it bypasses '
      'the 015 art guard and must stay internal';
  end if;

  -- 9i. anon must not have picked up execute on the new write paths
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fn_create_sku_model','fn_ensure_sku_variant',
                      'fn_replace_sku_art','fn_sync_sku_variants')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception '027: anon holds EXECUTE on %', v_bad;
  end if;

  -- 9j. both triggers exist. The derive trigger is the ONLY writer of
  --     market_price_cents; without it prices silently stop tracking.
  if not exists (select 1 from pg_trigger
                 where tgname = 'trg_sku_variant_derive' and not tgisinternal) then
    raise exception '027: trg_sku_variant_derive is missing';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'trg_sku_model_propagate' and not tgisinternal) then
    raise exception '027: trg_sku_model_propagate is missing';
  end if;

  select count(*) into v_n from sku_models;
  raise notice '027 ok: % model(s), % variant(s), tier from model, art from model',
    v_n, (select count(*) from skus);
end $$;

commit;

-- ============================================================================
-- AFTER RUNNING — verify by hand
--
--   select m.brand, m.model, m.colorway, m.base_price_cents,
--          s.size_us, s.size_multiplier, s.price_override_cents,
--          s.market_price_cents, fn_tier_for_sku(s.id) as tier
--   from sku_models m join skus s on s.model_id = m.id
--   order by m.brand, m.model, s.size_us;
--
--   -- the derived column must refuse a direct write:
--   update skus set market_price_cents = 99999
--    where id = (select id from skus limit 1);   -- expect: RAISES
--
--   -- and a model price change must reach every size:
--   update sku_models set base_price_cents = base_price_cents
--    where id = (select id from sku_models limit 1);  -- no-op, but propagates
--
-- Then, per the 026b checklist, before trusting anything:
--   1. run scripts/smoke_settlement.sql
--   2. load / signed out, in a private window
--   3. load /card/<id> signed out
--
-- Step 2 matters here specifically: the market grid and card pages read
-- skus.art_url and skus.market_price_cents as anon.
--
-- ---------------------------------------------------------------------------
-- APP-LAYER FOLLOW-UPS THIS MIGRATION CREATES (none of them are optional)
--
--   * Anything writing skus.market_price_cents now RAISES. upsertSku and the
--     admin SKU bench must write sku_models.base_price_cents (or
--     skus.price_override_cents) instead.
--   * fn_replace_sku_art now changes art for EVERY size of a model. The admin
--     UI should say so before the upload.
--   * The success metric becomes "models with more than one card":
--       select count(*) from (
--         select s.model_id from cards c join skus s on s.id = c.sku_id
--         group by s.model_id having count(*) > 1) x;
--   * sku_float_curve is still keyed on the VARIANT. Nothing populates it and
--     fn_float_multiplier falls back to the linear curve, so this is inert —
--     but it belongs on the model when it stops being inert.
--   * watchlists.sku_id watches ONE SIZE. Watching a model is what a user
--     actually means; needs a model_id column eventually.
--   * Duplicate prevention is the real remaining work: fuzzy match on
--     brand + model + colourway at entry, and a model-level merge tool at
--     review. Free text otherwise produces "AJ1 Chicago", "Jordan 1 Chicago"
--     and "Air Jordan 1 Retro High OG Chicago" as three models.
--   * A tier-coloured placeholder art asset, so minting never waits on the
--     manual Perchance loop.
-- ============================================================================
