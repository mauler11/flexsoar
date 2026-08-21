-- 020_platform_earnings.sql
--
-- RUN 019a, 019b AND 019c FIRST.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM THIS SOLVES
-- ---------------------------------------------------------------------------
-- Buyer cash and earned commission arrive in the same Stripe balance. Stripe
-- cannot partition a balance, so nothing at the payments layer distinguishes
-- "money I am holding against outstanding FSC" from "money I have earned and
-- may spend". That distinction has to live here, or it lives in the operator's
-- head, and money held in someone's head gets spent.
--
-- ---------------------------------------------------------------------------
-- THE IDENTITY
-- ---------------------------------------------------------------------------
-- From 019c, for every settlement:
--   platform currency = cash_in   - (net if seller takes cash else 0)
--   platform credit   = credit_in - (net if seller takes FSC  else 0)
--
-- Across all four quadrants those collapse to a single fact:
--
--   platform currency balance - FSC liability = commission earned, exactly
--
-- So:
--   earned_gross = ledger currency balance (is_platform) - fn_credit_liability()
--   unswept      = earned_gross - everything already moved out
--
-- And solvency is one comparison: unswept >= 0. If it goes negative, cash has
-- left that was backing outstanding FSC. There is no operation in 019c that can
-- produce that, so a negative reading means either a chargeback landed or
-- something wrote to the ledger outside the contract. Both are worth knowing
-- about the same week.
--
-- ---------------------------------------------------------------------------
-- WHY SWEEPS ARE NOT LEDGER ENTRIES
-- ---------------------------------------------------------------------------
-- A sweep is the operator moving their own money between their own bank
-- accounts. It has no counterparty, so it cannot net to zero, and forcing it
-- into ledger_entries would mean either weakening 016's constraint or
-- inventing a fake counterparty account. The ledger stays marketplace-only.
--
-- Safe to re-run.

begin;

-- 1. Sweeps -----------------------------------------------------------------

create table if not exists sweeps (
  id           uuid        primary key default gen_random_uuid(),
  amount_cents bigint      not null check (amount_cents > 0),
  bank_ref     text,
  note         text,
  created_by   uuid        not null references users(id),
  swept_at     timestamptz not null default now()
);

comment on table sweeps is
  'Commission moved out of the pooled operating account into the operator''s '
  'spending account. Not a ledger event - there is no counterparty. The '
  'over-sweep trigger is the thing that makes the pool safe; do not disable it.';

create index if not exists sweeps_swept_at_idx on sweeps (swept_at desc);

alter table sweeps enable row level security;

drop policy if exists sweeps_admin_all on sweeps;
create policy sweeps_admin_all on sweeps
  for all using (fn_is_admin()) with check (fn_is_admin());


-- 2. Position ---------------------------------------------------------------
-- Internal, unguarded. Every caller that a human can reach goes through
-- fn_platform_position(), which requires admin.

create or replace function fn_platform_position_raw()
returns table (
  currency_balance_cents bigint,
  credit_liability_cents bigint,
  earned_gross_cents     bigint,
  swept_cents            bigint,
  unswept_cents          bigint,
  reserve_cents          bigint,
  sweepable_cents        bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with pos as (
    select
      (select coalesce(sum(amount_cents * direction), 0)::bigint
         from ledger_entries
        where is_platform and asset = 'currency')          as cur,
      fn_credit_liability()                                as liab,
      (select coalesce(sum(amount_cents), 0)::bigint
         from sweeps)                                      as swept
  )
  select
    pos.cur,
    pos.liab,
    pos.cur - pos.liab,
    pos.swept,
    pos.cur - pos.liab - pos.swept,
    greatest(
      coalesce(fn_config_num('sweep_reserve_min_cents'), 0),
      floor(greatest(pos.liab, 0)
            * coalesce(fn_config_num('sweep_reserve_bps'), 0) / 10000.0)::bigint
    ),
    greatest(
      pos.cur - pos.liab - pos.swept
      - greatest(
          coalesce(fn_config_num('sweep_reserve_min_cents'), 0),
          floor(greatest(pos.liab, 0)
                * coalesce(fn_config_num('sweep_reserve_bps'), 0) / 10000.0)::bigint
        ),
      0
    )
  from pos;
$function$;

create or replace function fn_platform_position()
returns table (
  currency_balance_cents bigint,
  credit_liability_cents bigint,
  earned_gross_cents     bigint,
  swept_cents            bigint,
  unswept_cents          bigint,
  reserve_cents          bigint,
  sweepable_cents        bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform fn_require_admin();
  return query select * from fn_platform_position_raw();
end;
$function$;

comment on function fn_platform_position() is
  'unswept_cents is commission earned and not yet moved out. sweepable_cents '
  'is unswept minus the chargeback reserve, floored at zero - that is the '
  'number to transfer. Never spend against earned_gross: it includes money '
  'already swept.';


-- 3. Over-sweep guard -------------------------------------------------------
-- The whole point of the exercise. A sweep larger than unswept commission is
-- spending buyer money, and it is refused in the database rather than in a
-- dashboard that can be bypassed.

create or replace function fn_guard_sweep()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_unswept bigint;
begin
  select unswept_cents into v_unswept from fn_platform_position_raw();

  if new.amount_cents > v_unswept then
    raise exception
      'sweep of % cents exceeds unswept commission of % cents - the difference is buyer funds backing outstanding FSC',
      new.amount_cents, v_unswept;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_sweeps_guard on sweeps;
create trigger trg_sweeps_guard
  before insert on sweeps
  for each row execute function fn_guard_sweep();

-- Sweeps are append-only. Editing an amount after the fact would silently
-- reopen the headroom the guard just closed.
create or replace function fn_block_sweep_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'sweeps are append-only; record a correcting entry instead';
end;
$function$;

drop trigger if exists trg_sweeps_immutable on sweeps;
create trigger trg_sweeps_immutable
  before update or delete on sweeps
  for each row execute function fn_block_sweep_mutation();


-- 4. Recording a sweep ------------------------------------------------------

create or replace function fn_record_sweep(
  p_amount_cents bigint,
  p_bank_ref     text default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid;
  v_id    uuid;
begin
  v_admin := fn_require_admin();

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'sweep amount must be positive';
  end if;

  insert into sweeps (amount_cents, bank_ref, note, created_by)
  values (p_amount_cents, p_bank_ref, p_note, v_admin)
  returning id into v_id;

  return v_id;
end;
$function$;


-- 5. Reconciliation against the real balance --------------------------------
-- The ledger is internally consistent by construction. What it cannot know is
-- whether the bank agrees. Pass the actual operating account balance and this
-- reports the gap. A chargeback shows up here first.

create or replace function fn_check_solvency(p_actual_cents bigint default null)
returns table (
  ok               boolean,
  expected_cents   bigint,
  actual_cents     bigint,
  variance_cents   bigint,
  liability_cents  bigint,
  unswept_cents    bigint,
  detail           text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  p record;
  v_expected bigint;
begin
  perform fn_require_admin();

  select * into p from fn_platform_position_raw();
  v_expected := p.currency_balance_cents - p.swept_cents;

  return query select
    (p.unswept_cents >= 0)
      and (p_actual_cents is null or p_actual_cents >= p.credit_liability_cents),
    v_expected,
    p_actual_cents,
    case when p_actual_cents is null then null else p_actual_cents - v_expected end,
    p.credit_liability_cents,
    p.unswept_cents,
    case
      when p.unswept_cents < 0 then
        'INSOLVENT: cash backing outstanding FSC has left the pool. Check for chargebacks or writes outside the contract.'
      when p_actual_cents is not null and p_actual_cents < p.credit_liability_cents then
        'INSOLVENT: real balance is below outstanding FSC liability.'
      when p_actual_cents is not null and p_actual_cents <> v_expected then
        'Ledger and bank disagree. Not necessarily insolvent - Stripe holds and in-flight payouts also show up here - but reconcile before sweeping.'
      else
        'OK'
    end;
end;
$function$;


-- 6. Config -----------------------------------------------------------------

insert into platform_config (key, num_value, bool_value, note) values
  ('sweep_reserve_bps', 1500, null,
   'Share of outstanding FSC liability held back from sweeping as a chargeback '
   'buffer. 1500 = 15%. This is the difference between a dispute being annoying '
   'and being fatal.'),
  ('sweep_reserve_min_cents', 50000, null,
   'Floor on the chargeback buffer regardless of liability, in USD cents. '
   'Early on, liability is near zero while a single disputed sale is not.')
on conflict (key) do nothing;


-- 7. Grants -----------------------------------------------------------------

revoke execute on function fn_platform_position_raw()          from anon, authenticated;
revoke execute on function fn_guard_sweep()                    from anon, authenticated;
grant  execute on function fn_platform_position()              to authenticated;
grant  execute on function fn_record_sweep(bigint, text, text) to authenticated;
grant  execute on function fn_check_solvency(bigint)           to authenticated;

commit;
