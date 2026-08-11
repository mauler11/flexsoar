-- ============================================================
-- FlexSoar — 008_grading.sql
-- Run in the Supabase SQL editor, "Run without RLS".
-- ============================================================
-- The grading queue had no write path: no fn_grade_item, no
-- fn_authenticate_item, and nothing to move an item to in_custody.
-- scripts/seed.ts wrote items directly under service-role, which is not
-- a path the admin UI can or should use.
--
-- Also takes HANDOFF item 15 now rather than later: the six rubric
-- components get real columns instead of living as JSON inside
-- grading_notes. Backfilling six columns after a few hundred grades is
-- worse than adding them before the first one.
--
-- Weights, from docs/GRADING_RUBRIC.md:
--   outsole 25%  midsole 20%  creasing 20%
--   upper   20%  heel    10%  accessories 5%
-- ============================================================

-- ------------------------------------------------------------
-- 1. Component columns
-- ------------------------------------------------------------

alter table items
  add column if not exists grade_outsole     numeric(3,2) check (grade_outsole     between 0 and 1),
  add column if not exists grade_midsole     numeric(3,2) check (grade_midsole     between 0 and 1),
  add column if not exists grade_creasing    numeric(3,2) check (grade_creasing    between 0 and 1),
  add column if not exists grade_upper       numeric(3,2) check (grade_upper       between 0 and 1),
  add column if not exists grade_heel        numeric(3,2) check (grade_heel        between 0 and 1),
  add column if not exists grade_accessories numeric(3,2) check (grade_accessories between 0 and 1);

-- The float must equal the weighted sum whenever components are present.
-- Rows graded before this migration have null components and are exempt,
-- so this does not invalidate existing data.
alter table items drop constraint if exists items_grade_components_sum;
alter table items add constraint items_grade_components_sum check (
  grade_outsole is null
  or float_value = round(
       grade_outsole     * 0.25 +
       grade_midsole     * 0.20 +
       grade_creasing    * 0.20 +
       grade_upper       * 0.20 +
       grade_heel        * 0.10 +
       grade_accessories * 0.05
     , 3)
);

-- All six or none.
alter table items drop constraint if exists items_grade_components_complete;
alter table items add constraint items_grade_components_complete check (
  num_nonnulls(grade_outsole, grade_midsole, grade_creasing,
               grade_upper, grade_heel, grade_accessories) in (0, 6)
);

-- ------------------------------------------------------------
-- 2. Grade an item
--    Components are optional so the seed script and any legacy path
--    still work, but when supplied the constraint above enforces that
--    the float is genuinely their weighted sum — the grader cannot
--    decide the total first and back-fill components to match.
-- ------------------------------------------------------------

create or replace function fn_grade_item(
  p_item_id     uuid,
  p_float       numeric,
  p_notes       text          default null,
  p_outsole     numeric(3,2)  default null,
  p_midsole     numeric(3,2)  default null,
  p_creasing    numeric(3,2)  default null,
  p_upper       numeric(3,2)  default null,
  p_heel        numeric(3,2)  default null,
  p_accessories numeric(3,2)  default null)
returns void language plpgsql security definer as $$
declare
  v_admin uuid;
  v_item  items%rowtype;
begin
  v_admin := fn_require_admin();

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;

  if v_item.status not in ('pending_intake', 'in_custody') then
    raise exception 'item % is %, cannot be graded', p_item_id, v_item.status;
  end if;

  -- A minted card carries an immutable copy of the float. Re-grading
  -- after mint would silently desync the card from the item.
  if exists (select 1 from cards where item_id = p_item_id) then
    raise exception 'item % is already minted; its float is immutable', p_item_id;
  end if;

  update items set
    float_value       = p_float,
    grading_notes     = coalesce(p_notes, grading_notes),
    grade_outsole     = p_outsole,
    grade_midsole     = p_midsole,
    grade_creasing    = p_creasing,
    grade_upper       = p_upper,
    grade_heel        = p_heel,
    grade_accessories = p_accessories,
    graded_by         = v_admin,
    graded_at         = now(),
    status            = case
                          when authenticated_at is not null then 'in_custody'
                          else status
                        end
  where id = p_item_id;
end $$;

-- ------------------------------------------------------------
-- 3. Authenticate an item
-- ------------------------------------------------------------

create or replace function fn_authenticate_item(
  p_item_id uuid, p_location text default null)
returns void language plpgsql security definer as $$
declare
  v_admin uuid;
  v_item  items%rowtype;
begin
  v_admin := fn_require_admin();

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;

  if v_item.status not in ('pending_intake', 'in_custody') then
    raise exception 'item % is %, cannot be authenticated', p_item_id, v_item.status;
  end if;

  update items set
    authenticated_by = v_admin,
    authenticated_at = now(),
    custody_location = coalesce(p_location, custody_location),
    status           = case
                         when graded_at is not null then 'in_custody'
                         else status
                       end
  where id = p_item_id;
end $$;

-- ------------------------------------------------------------
-- 4. Reject an item — failed authentication, returns to consignor
-- ------------------------------------------------------------

create or replace function fn_reject_item(p_item_id uuid, p_reason text)
returns void language plpgsql security definer as $$
declare v_item items%rowtype;
begin
  perform fn_require_admin();

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;
  if exists (select 1 from cards where item_id = p_item_id) then
    raise exception 'item % is minted and cannot be rejected', p_item_id;
  end if;

  update items set
    status        = 'returned_to_consignor',
    grading_notes = coalesce(grading_notes || E'\n', '') || 'REJECTED: ' || p_reason
  where id = p_item_id;
end $$;

-- ------------------------------------------------------------
-- 5. Grants — session client only, guarded internally like 005
-- ------------------------------------------------------------

grant execute on function fn_grade_item(uuid, numeric, text, numeric, numeric,
  numeric, numeric, numeric, numeric) to authenticated;
grant execute on function fn_authenticate_item(uuid, text) to authenticated;
grant execute on function fn_reject_item(uuid, text) to authenticated;
