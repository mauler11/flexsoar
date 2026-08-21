-- 018_condition_grades.sql
--
-- Categorical condition grades replace the published numeric float.
--
-- The float is NOT removed. items.float_value and cards.float_value keep being
-- computed from the six rubric columns exactly as they are today, because
-- fn_float_multiplier() prices off them and because the stored numbers are the
-- calibration set for building a real point system once FlexSoar grades
-- physical inventory. What changes is that the number stops being published:
-- a three-decimal figure derived from a seller's own answers is false
-- precision, and it is not defensible in a dispute.
--
-- Band boundaries live in a table, not in code, because they WILL be retuned
-- once there is measured inventory to calibrate against. Retuning is then an
-- UPDATE plus a backfill, not a migration.
--
-- Safe to re-run.

begin;

-- 1. The grade enum ---------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'condition_grade') then
    create type condition_grade as enum (
      'factory_new',
      'minimal_wear',
      'field_tested',
      'well_worn',
      'battle_scarred'
    );
  end if;
end $$;


-- 2. Band table -------------------------------------------------------------
-- Half-open intervals: [min_float, max_float). battle_scarred's upper bound is
-- deliberately 1.001 so that a float of exactly 1.000 lands somewhere.

create table if not exists condition_bands (
  grade      condition_grade primary key,
  label      text            not null,
  min_float  numeric(4,3)    not null check (min_float >= 0 and min_float <= 1),
  max_float  numeric(4,3)    not null check (max_float >  0 and max_float <= 1.001),
  sort_order smallint        not null unique,
  constraint condition_bands_range check (min_float < max_float)
);

comment on table condition_bands is
  'Float-to-grade mapping. Boundaries are provisional and calibrated against '
  'seller-declared data only. Retune once FlexSoar grades physical inventory, '
  'then re-run the backfill at the bottom of migration 018.';

insert into condition_bands (grade, label, min_float, max_float, sort_order) values
  ('factory_new',    'Factory New',    0.000, 0.080, 1),
  ('minimal_wear',   'Minimal Wear',   0.080, 0.200, 2),
  ('field_tested',   'Field-Tested',   0.200, 0.450, 3),
  ('well_worn',      'Well-Worn',      0.450, 0.700, 4),
  ('battle_scarred', 'Battle-Scarred', 0.700, 1.001, 5)
on conflict (grade) do nothing;


-- 3. Coverage check ---------------------------------------------------------
-- A gap between bands would silently produce NULL grades on valid floats.
-- This fails the migration rather than letting that ship.

do $$
declare
  v_gap integer;
begin
  select count(*) into v_gap
  from condition_bands a
  join condition_bands b on b.sort_order = a.sort_order + 1
  where a.max_float <> b.min_float;

  if v_gap > 0 then
    raise exception 'condition_bands has % gap/overlap(s) between adjacent bands', v_gap;
  end if;

  if (select min(min_float) from condition_bands) <> 0 then
    raise exception 'condition_bands does not start at 0.000';
  end if;
end $$;


-- 4. Derivation function ----------------------------------------------------
-- NULL float in, NULL grade out. Ungraded items stay ungraded.

create or replace function fn_grade_for_float(p_float numeric)
returns condition_grade
language sql
stable
as $$
  select b.grade
  from condition_bands b
  where p_float >= b.min_float
    and p_float <  b.max_float
  order by b.sort_order
  limit 1;
$$;


-- 5. Columns ----------------------------------------------------------------

alter table items add column if not exists condition_grade condition_grade;
alter table cards add column if not exists condition_grade condition_grade;

comment on column items.condition_grade is
  'Derived from float_value by trigger. Read grade_source to know whether the '
  'underlying float was seller-declared or FlexSoar-measured; the two must '
  'never render identically.';

comment on column cards.condition_grade is
  'Snapshot of the item grade at mint. Published. float_value is internal '
  'until platform_config.show_numeric_float is true.';


-- 6. Sync trigger -----------------------------------------------------------
-- Derived in a trigger rather than inside fn_grade_item / fn_mint_card /
-- fn_approve_submission, so that no existing write path needs editing and
-- nothing can insert a row whose grade disagrees with its float.

create or replace function fn_sync_condition_grade()
returns trigger
language plpgsql
as $$
begin
  new.condition_grade := fn_grade_for_float(new.float_value);
  return new;
end;
$$;

drop trigger if exists trg_items_condition_grade on items;
create trigger trg_items_condition_grade
  before insert or update of float_value on items
  for each row execute function fn_sync_condition_grade();

drop trigger if exists trg_cards_condition_grade on cards;
create trigger trg_cards_condition_grade
  before insert or update of float_value on cards
  for each row execute function fn_sync_condition_grade();


-- 7. Display flag -----------------------------------------------------------

insert into platform_config (key, num_value, bool_value, note) values
  ('show_numeric_float', null, false,
   'Publish the numeric float and float percentile in the UI. False until '
   'FlexSoar grades physical inventory - self-declared floats are not precise '
   'enough to display as three decimals. The grade renders either way.')
on conflict (key) do nothing;


-- 8. RLS and grants ---------------------------------------------------------

alter table condition_bands enable row level security;

drop policy if exists condition_bands_read on condition_bands;
create policy condition_bands_read on condition_bands
  for select using (true);

drop policy if exists condition_bands_admin_write on condition_bands;
create policy condition_bands_admin_write on condition_bands
  for all using (fn_is_admin()) with check (fn_is_admin());

grant select on condition_bands to anon, authenticated;
grant execute on function fn_grade_for_float(numeric) to anon, authenticated;


-- 9. Backfill ---------------------------------------------------------------
-- Re-run this block on its own after any change to condition_bands.

update items
   set condition_grade = fn_grade_for_float(float_value)
 where float_value is not null
   and condition_grade is distinct from fn_grade_for_float(float_value);

update cards
   set condition_grade = fn_grade_for_float(float_value)
 where condition_grade is distinct from fn_grade_for_float(float_value);


-- 10. Tighten ---------------------------------------------------------------
-- cards.float_value is NOT NULL, so every card must land in a band. If this
-- fails, a band boundary is wrong - fix condition_bands and re-run from 9.

do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans from cards where condition_grade is null;
  if v_orphans > 0 then
    raise exception '% card(s) have a float that falls outside every band', v_orphans;
  end if;
end $$;

alter table cards alter column condition_grade set not null;

commit;
