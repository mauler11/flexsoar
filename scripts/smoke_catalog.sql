-- ============================================================================
-- FlexSoar — catalog smoke script
-- scripts/smoke_catalog.sql
--
-- Exercises the 027 model/variant catalog against LIVE SQL: derivation,
-- propagation, tier-from-model, the derived-column refusal, the art guards at
-- both levels, size validation, permissions, and the duplicate metric.
--
-- Wrapped in BEGIN ... ROLLBACK. Nothing persists. Safe against the live
-- project.
--
-- RUN IN: Supabase SQL editor, "Run without RLS" (postgres role).
--         Admin-guarded steps impersonate a seeded admin inside the txn,
--         because fn_require_admin() refuses postgres — superuser is not the
--         same thing as an authenticated admin.
--
-- FAILURE MODE: any assertion raises and the whole transaction unwinds. The
-- message names the section and the invariant.
--
-- Sections:
--   C1  a model, four sizes, derived prices
--   C2  one price change reaches every size; minted tiers do not move
--   C3  TIER COMES FROM THE MODEL, value stays per-variant
--   C4  market_price_cents refuses a direct write
--   C5  an unpriced model cannot mint — no new gate needed
--   C6  art is one asset per model, and replacement propagates
--   C7  direct art writes are blocked at both levels
--   C8  size validation on the seller-callable variant path
--   C9  permissions: who may create a model vs a variant
--   C10 the metric that 027 exists to make measurable
--
-- TIER BANDS in force (003), USD cents:
--   1 Common 0-6000 | 2 Uncommon 6000-12000 | 3 Rare 12000-25000
--   4 Epic 25000-50000 | 5 Legendary 50000+
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- PREFLIGHT — fail loudly before doing any work
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes   int;
  v_missing text;
begin
  select count(*) into v_dupes from (
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
    group by p.proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'PREFLIGHT: % function name(s) have multiple arities. '
      'Overloads silently serve callers. Fix before trusting this run.', v_dupes;
  end if;

  if to_regclass('public.sku_models') is null then
    raise exception 'PREFLIGHT: sku_models does not exist — 027 has not been applied';
  end if;

  -- Every 027 object this script depends on.
  select string_agg(x.name, ', ') into v_missing
  from (values
    ('fn_tier_for_sku'), ('fn_sync_sku_variants'),
    ('fn_create_sku_model'), ('fn_ensure_sku_variant'),
    ('fn_guard_sku_model_art_url'), ('trg_sku_variant_derive'),
    ('trg_sku_model_propagate')
  ) as x(name)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = x.name
  );
  if v_missing is not null then
    raise exception 'PREFLIGHT: missing 027 function(s): %', v_missing;
  end if;

  select string_agg(x.name, ', ') into v_missing
  from (values
    ('trg_sku_variant_derive'), ('trg_sku_model_propagate'),
    ('trg_guard_sku_model_art_url'), ('trg_guard_sku_art_url')
  ) as x(name)
  where not exists (
    select 1 from pg_trigger where tgname = x.name and not tgisinternal
  );
  if v_missing is not null then
    raise exception 'PREFLIGHT: missing trigger(s): %', v_missing;
  end if;

  -- The internal propagator must be unreachable from every client role: it
  -- carries the 015 art-guard bypass.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'),('authenticated'),('service_role')) as r(rolname)
    where n.nspname = 'public'
      and p.proname = 'fn_sync_sku_variants'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  ) then
    raise exception
      'PREFLIGHT: fn_sync_sku_variants is callable by a client role — that '
      'hands out the art-guard bypass';
  end if;

  raise notice 'PREFLIGHT ok: 027 objects present, propagator internal';
end $$;


-- ---------------------------------------------------------------------------
-- FIXTURES
-- ---------------------------------------------------------------------------
create temporary table _ids (k text primary key, v uuid) on commit drop;
create temporary table _log (step text, note text) on commit drop;

-- The discipline is to read _ids BEFORE switching role — the temp tables
-- belong to postgres and an impersonated block cannot see them. These grants
-- are insurance against a future edit reintroducing that, not a licence to
-- stop being careful.
grant select on _ids, _log to authenticated;

do $$
declare
  u_admin  uuid := gen_random_uuid();
  u_seller uuid := gen_random_uuid();
  v_tag    text := substr(replace(gen_random_uuid()::text,'-',''),1,8);
begin
  begin
    if to_regclass('auth.users') is not null then
      insert into auth.users (id, email)
      values (u_admin,  'smoke.cat.admin.' ||v_tag||'@example.test'),
             (u_seller, 'smoke.cat.seller.'||v_tag||'@example.test')
      on conflict (id) do nothing;
    end if;
  exception when others then
    raise notice 'auth.users seed skipped (%). Continuing.', sqlerrm;
  end;

  -- country_code is set on both: nothing here lists, but a null country makes
  -- fn_payout_method_for_user raise (025) and that is a trap worth avoiding.
  insert into users (id, auth_id, handle, email, country_code, is_admin)
  values (u_admin, u_admin, ('smoke_cat_a_'||v_tag)::text,
          ('smoke.cat.admin.'||v_tag||'@example.test')::text, 'MY', true);

  insert into users (id, auth_id, handle, email, country_code, is_admin)
  values (u_seller, u_seller, ('smoke_cat_s_'||v_tag)::text,
          ('smoke.cat.seller.'||v_tag||'@example.test')::text, 'MY', false);

  insert into _ids values ('admin', u_admin), ('seller', u_seller);
  raise notice 'FIXTURES ok: 1 admin, 1 plain seller';
end $$;


-- ---------------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------------

-- Become the seeded admin. fn_require_admin() reads auth.uid(), which
-- superuser does not have.
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
declare v_a uuid;
begin
  select v into v_a from _ids where k = 'admin';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Mint a card on a given variant. Mirrors the settlement script's fixture:
-- authenticate BEFORE grading, since fn_grade_item only promotes status when
-- authenticated_at is already set; and set all six rubric components equal to
-- the target float, which satisfies items_grade_components_sum exactly.
create or replace function pg_temp.mk_card(p_owner uuid, p_sku uuid)
returns uuid language plpgsql as $$
declare v_item uuid; v_card uuid;
begin
  insert into items (sku_id, consignor_id, status, custody, custody_holder_id,
                     grade_source, submitted_payout, photos, asking_price_cents)
  values (p_sku, p_owner, 'in_custody', 'warehouse', null,
          'seller_declared', 'cash', '[]'::jsonb, 10000)
  returning id into v_item;

  perform pg_temp.as_admin();
  perform fn_authenticate_item(v_item, 'smoke catalog');
  perform fn_grade_item(v_item, 0.120, 'smoke catalog',
                        0.120, 0.120, 0.120, 0.120, 0.120, 0.120);
  v_card := fn_mint_card(v_item, p_owner);
  perform pg_temp.as_postgres();

  return v_card;
end $$;


-- ---------------------------------------------------------------------------
-- C1 — a model, four sizes, derived prices
--
-- The structural claim of 027: ONE pricing decision and ONE art asset produce
-- N sizes. Under the old schema this was four rows, four prices, four art
-- assets, and four rows toward a metric that could never exceed one card each.
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid;
  v_tag   text := substr(replace(gen_random_uuid()::text,'-',''),1,8);
  v_s9    uuid; v_s95 uuid; v_s10 uuid; v_s13 uuid;
  v_again uuid;
  v_bad   text;
begin
  perform pg_temp.as_admin();
  v_model := fn_create_sku_model('SmokeCat', 'CatModel '||v_tag, 'Test/Base', 20000);
  perform pg_temp.as_postgres();

  if v_model is null then raise exception 'C1: fn_create_sku_model returned null'; end if;

  v_s9  := fn_ensure_sku_variant(v_model,  9.0);
  v_s95 := fn_ensure_sku_variant(v_model,  9.5);
  v_s10 := fn_ensure_sku_variant(v_model, 10.0);
  v_s13 := fn_ensure_sku_variant(v_model, 13.0);

  -- one price decision, four variants
  select string_agg(size_us::text || '=' || coalesce(market_price_cents::text,'null'), ', ')
    into v_bad
  from skus where model_id = v_model and market_price_cents is distinct from 20000;
  if v_bad is not null then
    raise exception 'C1: variant(s) did not derive the base price: %', v_bad;
  end if;

  if (select count(*) from skus where model_id = v_model) <> 4 then
    raise exception 'C1: expected 4 variants, got %',
      (select count(*) from skus where model_id = v_model);
  end if;

  -- multiplier ships flat
  if exists (select 1 from skus where model_id = v_model and size_multiplier <> 1.000) then
    raise exception 'C1: a variant shipped with a non-flat size_multiplier';
  end if;

  -- identity belongs to the model; the copy on skus must agree
  select string_agg(s.id::text, ', ') into v_bad
  from skus s join sku_models m on m.id = s.model_id
  where s.model_id = v_model
    and (s.brand is distinct from m.brand
      or s.model is distinct from m.model
      or s.colorway is distinct from m.colorway);
  if v_bad is not null then
    raise exception 'C1: variant identity disagrees with its model: %', v_bad;
  end if;

  -- create-on-demand is idempotent: the tenth person listing this shoe in a
  -- size that already exists must not fork a second variant
  v_again := fn_ensure_sku_variant(v_model, 9.5);
  if v_again <> v_s95 then
    raise exception 'C1: fn_ensure_sku_variant forked a duplicate for US9.5';
  end if;
  if (select count(*) from skus where model_id = v_model) <> 4 then
    raise exception 'C1: variant count changed on a repeat ensure';
  end if;

  -- a variant carrying identity from a WRONG brand must be corrected on insert
  insert into skus (brand, model, colorway, size_us, model_id)
  values ('WrongBrand', 'WrongModel', 'Wrong/Colour', 11.0, v_model);
  if (select brand from skus where model_id = v_model and size_us = 11.0)
     <> 'SmokeCat' then
    raise exception 'C1: a direct insert kept its own brand instead of the model''s';
  end if;
  delete from skus where model_id = v_model and size_us = 11.0;

  insert into _ids values
    ('model', v_model), ('s9', v_s9), ('s95', v_s95),
    ('s10', v_s10), ('s13', v_s13);
  insert into _log values ('C1', 'one model, four sizes, all at 20000');
  raise notice 'C1 ok: one pricing decision produced 4 variants at 20000';
end $$;


-- ---------------------------------------------------------------------------
-- C2 — one price change reaches every size, and minted tiers do not move
--
-- Propagation is the AFTER UPDATE trigger on sku_models calling
-- fn_sync_sku_variants, which forces the derive trigger to recompute.
--
-- The second half matters as much as the first: cards.tier is a snapshot taken
-- at mint. An oracle that moves must not silently re-rank cards people already
-- own — that is the same immutability rule as float_value.
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid; v_s10 uuid; v_card uuid; v_seller uuid;
  v_tier_before smallint; v_bad text;
begin
  select v into v_model  from _ids where k = 'model';
  select v into v_s10    from _ids where k = 's10';
  select v into v_seller from _ids where k = 'seller';

  -- mint one card at the OLD price so we can watch it not move
  v_card := pg_temp.mk_card(v_seller, v_s10);
  select tier into v_tier_before from cards where id = v_card;
  if v_tier_before <> 3 then
    raise exception 'C2: 20000 should be tier 3 (Rare) under the 003 bands, got %',
      v_tier_before;
  end if;

  update sku_models set base_price_cents = 26000 where id = v_model;

  select string_agg(size_us::text || '=' || coalesce(market_price_cents::text,'null'), ', ')
    into v_bad
  from skus where model_id = v_model and market_price_cents is distinct from 26000;
  if v_bad is not null then
    raise exception
      'C2: a base price change did not reach every size — %. The propagate '
      'trigger or fn_sync_sku_variants is not firing.', v_bad;
  end if;

  -- future mints move band; the existing card does not
  if fn_tier_for_sku(v_s10) <> 4 then
    raise exception 'C2: 26000 should be tier 4 (Epic), got %', fn_tier_for_sku(v_s10);
  end if;
  if (select tier from cards where id = v_card) <> v_tier_before then
    raise exception
      'C2: an already-minted card was re-tiered by an oracle change (% -> %)',
      v_tier_before, (select tier from cards where id = v_card);
  end if;

  insert into _ids values ('card_old_tier', v_card);
  insert into _log values ('C2', '20000 -> 26000 reached 4 sizes; minted tier held at 3');
  raise notice 'C2 ok: one update repriced 4 sizes; the minted card kept tier %',
    v_tier_before;
end $$;


-- ---------------------------------------------------------------------------
-- C3 — TIER COMES FROM THE MODEL, VALUE STAYS PER-VARIANT
--
-- The one behavioural change 027 makes, and the reason for it: tier is drawn
-- as the border colour on an art asset SHARED across sizes. If a US9 were Rare
-- and a US13 Epic, one sprite would carry two frames, or the badge would
-- contradict the frame.
--
-- So an override that crosses a band boundary must move the card's VALUE and
-- must NOT move its TIER. Before 027 both read the same column and this test
-- would fail.
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid; v_s9 uuid; v_s13 uuid; v_seller uuid;
  v_card_plain uuid; v_card_over uuid;
  v_t_plain smallint; v_t_over smallint;
  v_v_plain bigint;   v_v_over bigint;
begin
  select v into v_model  from _ids where k = 'model';
  select v into v_s9     from _ids where k = 's9';
  select v into v_s13    from _ids where k = 's13';
  select v into v_seller from _ids where k = 'seller';

  -- US13 is marked well below base: 8000 would be tier 2 on its own, against
  -- the model's 26000 which is tier 4.
  update skus set price_override_cents = 8000 where id = v_s13;

  if (select market_price_cents from skus where id = v_s13) <> 8000 then
    raise exception 'C3: the override did not take effect on market_price_cents';
  end if;
  if (select market_price_cents from skus where id = v_s9) <> 26000 then
    raise exception 'C3: the override leaked onto a sibling variant';
  end if;

  if fn_tier_for_price(8000) <> 2 then
    raise exception 'C3: fixture assumption wrong — 8000 should be tier 2 alone';
  end if;

  v_card_plain := pg_temp.mk_card(v_seller, v_s9);
  v_card_over  := pg_temp.mk_card(v_seller, v_s13);

  select tier into v_t_plain from cards where id = v_card_plain;
  select tier into v_t_over  from cards where id = v_card_over;

  if v_t_plain <> v_t_over then
    raise exception
      'C3: TIER LEAKED FROM THE VARIANT — US9 minted tier %, US13 minted tier %. '
      'Both render the same art asset, so their borders now disagree.',
      v_t_plain, v_t_over;
  end if;
  if v_t_over <> 4 then
    raise exception 'C3: tier should be the model''s 4, got %', v_t_over;
  end if;

  -- ...but value is genuinely per-variant, which is the whole point of keeping
  -- an override at all
  v_v_plain := fn_card_value_cents(v_card_plain);
  v_v_over  := fn_card_value_cents(v_card_over);
  if v_v_over >= v_v_plain then
    raise exception
      'C3: the overridden variant is not worth less (% vs %) — value is not '
      'tracking market_price_cents', v_v_over, v_v_plain;
  end if;

  insert into _log values ('C3',
    format('tier %s on both; value %s vs %s', v_t_over, v_v_plain, v_v_over));
  raise notice
    'C3 ok: both sizes minted tier % from the model, values differ (% vs %)',
    v_t_over, v_v_plain, v_v_over;

  -- put it back so later sections see a clean model
  update skus set price_override_cents = null where id = v_s13;
end $$;


-- ---------------------------------------------------------------------------
-- C4 — market_price_cents refuses a direct write
--
-- Not "is overwritten silently". A price write that is ignored without saying
-- so is the same failure shape as sale_fee meaning two things, or
-- orders.fee_cents carrying a nominal number nobody realised was nominal.
-- ---------------------------------------------------------------------------
do $$
declare v_s9 uuid; v_before integer;
begin
  select v into v_s9 from _ids where k = 's9';
  select market_price_cents into v_before from skus where id = v_s9;

  begin
    update skus set market_price_cents = 99999 where id = v_s9;
    raise exception 'C4: A DIRECT PRICE WRITE WAS ACCEPTED — the derive trigger '
      'is not attached and prices have stopped tracking the model';
  exception when others then
    if sqlerrm like '%A DIRECT PRICE WRITE WAS ACCEPTED%' then raise; end if;
    if sqlerrm not like '%is derived%' then
      raise exception 'C4: the write was refused, but with the wrong error (%)', sqlerrm;
    end if;
    raise notice 'C4 ok: direct price write refused (%)', sqlerrm;
  end;

  if (select market_price_cents from skus where id = v_s9) <> v_before then
    raise exception 'C4: the refused write still changed the price';
  end if;

  -- an update that does NOT assert a price must pass straight through
  update skus set demand_score = 7 where id = v_s9;
  if (select market_price_cents from skus where id = v_s9) <> v_before then
    raise exception 'C4: an unrelated update perturbed the derived price';
  end if;

  insert into _log values ('C4', 'direct price write refused, unrelated update passed');
end $$;


-- ---------------------------------------------------------------------------
-- C5 — an unpriced model cannot mint
--
-- The handover claimed "no new gate is needed" because fn_mint_card already
-- raises when the oracle price is null. Under 027 that null now arrives via a
-- model with no base_price_cents. This pins that claim rather than assuming it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid; v_sku uuid; v_seller uuid; v_item uuid;
  v_tag text := substr(replace(gen_random_uuid()::text,'-',''),1,8);
begin
  select v into v_seller from _ids where k = 'seller';

  perform pg_temp.as_admin();
  v_model := fn_create_sku_model('SmokeCat', 'CatUnpriced '||v_tag, 'Test/Unpriced', null);
  perform pg_temp.as_postgres();

  v_sku := fn_ensure_sku_variant(v_model, 9.0);

  if (select market_price_cents from skus where id = v_sku) is not null then
    raise exception 'C5: a variant of an unpriced model got a price from nowhere';
  end if;
  if fn_tier_for_sku(v_sku) is not null then
    raise exception 'C5: an unpriced model produced a tier';
  end if;

  insert into items (sku_id, consignor_id, status, custody, grade_source,
                     submitted_payout, photos, asking_price_cents)
  values (v_sku, v_seller, 'in_custody', 'warehouse', 'seller_declared',
          'cash', '[]'::jsonb, 10000)
  returning id into v_item;

  perform pg_temp.as_admin();
  perform fn_authenticate_item(v_item, 'smoke catalog');
  perform fn_grade_item(v_item, 0.120, 'smoke catalog',
                        0.120, 0.120, 0.120, 0.120, 0.120, 0.120);

  begin
    perform fn_mint_card(v_item, v_seller);
    raise exception 'C5: AN UNPRICED MODEL MINTED A CARD';
  exception when others then
    if sqlerrm like '%AN UNPRICED MODEL MINTED%' then raise; end if;
    raise notice 'C5 ok: mint refused on an unpriced model (%)', sqlerrm;
  end;

  perform pg_temp.as_postgres();
  insert into _log values ('C5', 'unpriced model: no price, no tier, no mint');
end $$;


-- ---------------------------------------------------------------------------
-- C6 — art is one asset per model, and replacement propagates
--
-- The decisive economic argument for 027: the art workflow is manual, and
-- nothing about a pixel-art sneaker depends on size. One upload must cover
-- every size.
--
-- fn_replace_sku_art is the SANCTIONED path and sets the allow_art_replace
-- GUC, so a deliberate second replacement SUCCEEDS. That breadth is wider than
-- the pre-027 behaviour and is tested here on purpose.
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid; v_s9 uuid; v_s13 uuid; v_n int;
  v_url1 text := 'https://smoke.example.test/cat-a.png';
  v_url2 text := 'https://smoke.example.test/cat-b.png';
begin
  select v into v_model from _ids where k = 'model';
  select v into v_s9    from _ids where k = 's9';
  select v into v_s13   from _ids where k = 's13';

  perform pg_temp.as_admin();
  perform fn_replace_sku_art(v_s9, v_url1);
  perform pg_temp.as_postgres();

  if (select art_url from sku_models where id = v_model) is distinct from v_url1 then
    raise exception 'C6: the model did not receive the art';
  end if;

  select count(*) into v_n
  from skus where model_id = v_model and art_url is distinct from v_url1;
  if v_n > 0 then
    raise exception
      'C6: % variant(s) did not receive the model''s art — one upload is '
      'supposed to cover every size', v_n;
  end if;

  -- deliberate replacement through the sanctioned path, again covering all sizes
  perform pg_temp.as_admin();
  perform fn_replace_sku_art(v_s9, v_url2);
  perform pg_temp.as_postgres();

  select count(*) into v_n
  from skus where model_id = v_model and art_url is distinct from v_url2;
  if v_n > 0 then
    raise exception 'C6: a deliberate art replacement did not reach % variant(s)', v_n;
  end if;

  -- addressing it through a DIFFERENT size of the same model is the same act
  perform pg_temp.as_admin();
  perform fn_replace_sku_art(v_s13, v_url1);
  perform pg_temp.as_postgres();

  select count(*) into v_n
  from skus where model_id = v_model and art_url is distinct from v_url1;
  if v_n > 0 then
    raise exception 'C6: addressing the model via another size did not propagate';
  end if;

  insert into _log values ('C6', 'one art asset, propagated to 4 sizes, replaced twice');
  raise notice 'C6 ok: art set once reaches every size, and replacement does too';
end $$;


-- ---------------------------------------------------------------------------
-- C7 — direct art writes are blocked at BOTH levels
--
-- 015's guard on skus is kept as defence against a direct write to a variant;
-- 027 mirrors it onto the model. Neither may be bypassed except through
-- fn_replace_sku_art (admin) or fn_sync_sku_variants (internal).
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid; v_s9 uuid; v_before text;
begin
  select v into v_model from _ids where k = 'model';
  select v into v_s9    from _ids where k = 's9';
  select art_url into v_before from sku_models where id = v_model;

  begin
    update sku_models set art_url = 'https://smoke.example.test/sneaky.png'
     where id = v_model;
    raise exception 'C7: A DIRECT MODEL ART WRITE WAS ACCEPTED';
  exception when others then
    if sqlerrm like '%A DIRECT MODEL ART WRITE%' then raise; end if;
    raise notice 'C7 ok: direct model art write refused (%)', sqlerrm;
  end;

  begin
    update skus set art_url = 'https://smoke.example.test/sneaky.png' where id = v_s9;
    raise exception 'C7: A DIRECT VARIANT ART WRITE WAS ACCEPTED';
  exception when others then
    if sqlerrm like '%A DIRECT VARIANT ART WRITE%' then raise; end if;
    raise notice 'C7 ok: direct variant art write refused (%)', sqlerrm;
  end;

  if (select art_url from sku_models where id = v_model) is distinct from v_before then
    raise exception 'C7: a refused write still changed the art';
  end if;
  if exists (select 1 from skus where model_id = v_model
             and art_url is distinct from v_before) then
    raise exception 'C7: a refused write still changed a variant''s art';
  end if;

  insert into _log values ('C7', 'direct art writes refused at model and variant');
end $$;


-- ---------------------------------------------------------------------------
-- C8 — size validation on the seller-callable path
--
-- fn_ensure_sku_variant is reachable by any signed-in seller, so its inputs
-- are attacker-controlled in the ordinary sense: nonsense sizes should not
-- become permanent catalog rows.
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid; v_before int; v_ok boolean; v_id uuid;
  r record;
begin
  select v into v_model from _ids where k = 'model';
  select count(*) into v_before from skus where model_id = v_model;

  for r in select * from (values (2.0), (25.0), (9.3), (0.0)) as t(sz) loop
    v_ok := false;
    begin
      perform fn_ensure_sku_variant(v_model, r.sz);
    exception when others then
      v_ok := true;
    end;
    if not v_ok then
      raise exception 'C8: size % was ACCEPTED and should not have been', r.sz;
    end if;
  end loop;

  -- a legitimate half size still works
  v_id := fn_ensure_sku_variant(v_model, 8.5);
  if v_id is null then raise exception 'C8: a valid half size was refused'; end if;

  if (select count(*) from skus where model_id = v_model) <> v_before + 1 then
    raise exception 'C8: a rejected size still created a row';
  end if;

  delete from skus where id = v_id;
  insert into _log values ('C8', '4 bad sizes refused, 8.5 accepted');
  raise notice 'C8 ok: bad sizes refused, half sizes accepted';
end $$;


-- ---------------------------------------------------------------------------
-- C9 — who may create a model vs a variant
--
-- The asymmetry is the security boundary of 027. base_price_cents is the
-- ORACLE: it sets tier and feeds fn_card_value_cents, so a seller who can set
-- it can mint a Legendary from nothing and trade it for real inventory.
-- Creating a VARIANT confers nothing — its price is derived from a model the
-- seller cannot touch.
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid; v_seller uuid; v_ok boolean; v_id uuid; v_bad text;
begin
  select v into v_model  from _ids where k = 'model';
  select v into v_seller from _ids where k = 'seller';

  -- a plain seller must NOT be able to create a model
  perform pg_temp.as_user(v_seller);
  v_ok := false;
  begin
    perform fn_create_sku_model('SmokeCat', 'SellerMinted', 'Test/Nope', 5000000);
  exception when others then
    v_ok := true;
  end;
  perform pg_temp.as_postgres();
  if not v_ok then
    raise exception
      'C9: A PLAIN SELLER CREATED A PRICED MODEL — they can now mint a '
      'Legendary from nothing';
  end if;
  if exists (select 1 from sku_models where model = 'SellerMinted') then
    raise exception 'C9: the refused model was created anyway';
  end if;

  -- ...but a plain seller MAY add a size under an existing model
  perform pg_temp.as_user(v_seller);
  v_id := fn_ensure_sku_variant(v_model, 12.0);
  perform pg_temp.as_postgres();
  if v_id is null then
    raise exception 'C9: a signed-in seller could not add a size';
  end if;
  if (select market_price_cents from skus where id = v_id)
     is distinct from (select base_price_cents from sku_models where id = v_model) then
    raise exception 'C9: a seller-created variant did not derive the model price';
  end if;
  delete from skus where id = v_id;

  -- and anon must not reach either
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fn_create_sku_model','fn_ensure_sku_variant',
                      'fn_replace_sku_art','fn_sync_sku_variants')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'C9: anon holds EXECUTE on %', v_bad;
  end if;

  insert into _log values ('C9', 'model=admin only, variant=any seller, anon=neither');
  raise notice 'C9 ok: the oracle is admin-only, sizes are self-serve';
end $$;


-- ---------------------------------------------------------------------------
-- C10 — the metric 027 exists to make measurable
--
-- "SKUs with more than one card" was structurally incapable of exceeding 1 for
-- most shoes, because ten people listing one shoe in ten sizes produced ten
-- SKUs with one card each. By the old definition that is a gallery, despite
-- obviously being a real market for that shoe.
--
-- C2 and C3 already minted three cards across US9, US10 and US13 of one model.
-- ---------------------------------------------------------------------------
do $$
declare
  v_model uuid; v_cards int; v_variants int; v_models_multi int;
begin
  select v into v_model from _ids where k = 'model';

  select count(*), count(distinct c.sku_id) into v_cards, v_variants
  from cards c join skus s on s.id = c.sku_id
  where s.model_id = v_model;

  if v_cards < 3 then
    raise exception 'C10: expected at least 3 cards on this model, got %', v_cards;
  end if;
  if v_variants < 3 then
    raise exception
      'C10: expected those cards spread across at least 3 sizes, got %', v_variants;
  end if;

  select count(*) into v_models_multi from (
    select s.model_id
    from cards c join skus s on s.id = c.sku_id
    where s.model_id = v_model
    group by s.model_id having count(*) > 1
  ) x;

  if v_models_multi <> 1 then
    raise exception 'C10: the model did not register as having more than one card';
  end if;

  -- and the old, schema-artefact version of the metric would have said zero
  if exists (
    select 1 from cards c join skus s on s.id = c.sku_id
    where s.model_id = v_model
    group by c.sku_id having count(*) > 1
  ) then
    raise notice
      'C10: note — a single VARIANT also holds more than one card here, so the '
      'old metric would not have read zero on this fixture';
  else
    raise notice
      'C10: the old per-SKU metric reads ZERO on this fixture; the per-model '
      'metric reads 1. That gap is what 027 fixed.';
  end if;

  insert into _log values ('C10',
    format('%s cards across %s sizes of 1 model', v_cards, v_variants));
  raise notice 'C10 ok: % cards across % sizes register as one real market',
    v_cards, v_variants;
end $$;


-- ---------------------------------------------------------------------------
-- RESULTS
-- ---------------------------------------------------------------------------
-- Top-level reset: a set_config('role', ...) inside a plpgsql block does not
-- reliably unwind, and the temp tables belong to postgres.
reset role;
reset request.jwt.claims;

select * from _log order by step;

select m.brand, m.model, m.colorway, m.base_price_cents, m.art_url,
       s.size_us, s.size_multiplier, s.price_override_cents,
       s.market_price_cents, fn_tier_for_sku(s.id) as tier,
       (select count(*) from cards c where c.sku_id = s.id) as cards
from sku_models m join skus s on s.model_id = m.id
where m.brand = 'SmokeCat'
order by m.model, s.size_us;

rollback;

-- ============================================================================
-- If you reached here with no exception, the 027 catalog holds against live
-- SQL: one price and one art asset drive N sizes, tier comes from the model
-- while value stays per-variant, the derived column and both art guards refuse
-- direct writes, an unpriced model cannot mint, and the oracle is admin-only.
-- Nothing was written.
--
-- WHAT THIS SCRIPT DOES NOT COVER, deliberately:
--   * Settlement, vault custody and trades — scripts/smoke_settlement.sql.
--     That script's fixtures still insert into skus without a model_id and
--     write market_price_cents directly, so it fails until they are updated.
--   * Duplicate PREVENTION. Nothing here stops "AJ1 Chicago" and "Jordan 1
--     Chicago" becoming two models — that is fuzzy matching at entry plus a
--     merge tool at review, and it is app work, not schema.
--   * The anon page path. Like every script here, this runs as postgres and
--     impersonates. Loading / and /card/<id> signed out in a private window is
--     still a separate, mandatory step — that is exactly the gap that let 026b
--     through.
-- ============================================================================
