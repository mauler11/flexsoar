-- ============================================================================
-- 028_connect_notifications_retire.sql
--
-- Three additions, proposed by track/data (f7a4766) and reviewed here.
-- Schema is Claude's alone; agents never touch .sql.
--
-- ONE CORRECTION TO WHAT WAS PROPOSED: stripe_connect_account_id is TEXT, not
-- UUID. Stripe Express account ids look like acct_1AbCdEfGhIjKlMnO — a string
-- Stripe controls, not a UUID this database generates. Storing it as uuid
-- would reject every real value.
--
-- ONE ADDITION BEYOND WHAT WAS PROPOSED: fn_archive_sku_model. track/admin's
-- report calls archiveSkuModel() -> fn_archive_sku_model, but track/data's
-- schema proposal only listed fn_burn_card. This fills the gap rather than
-- leaving a function call with nothing behind it.
--
-- RUN IN: Supabase SQL editor, "Run without RLS". Single pass.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Connect columns
-- ---------------------------------------------------------------------------

alter table users
  add column if not exists stripe_connect_account_id   text,
  add column if not exists stripe_connect_payouts_enabled boolean not null default false;

comment on column users.stripe_connect_account_id is
  'Stripe Express account id (acct_...). Malaysia-only for now — payouts to '
  'any other country are not supported by a Stripe Malaysia platform.';

alter table orders
  add column if not exists paid_out          boolean not null default false,
  add column if not exists stripe_transfer_id text;

comment on column orders.paid_out is
  'True once a Stripe Transfer has been created for this order''s net_cents. '
  'Do not compute payout eligibility from this column alone — it only records '
  'that a transfer happened, not that it was allowed to.';

-- ---------------------------------------------------------------------------
-- 2. Notifications
--
-- One table, read by both the in-app bell and (going forward) anything else
-- that wants to know what happened to a user. Writes come from server-side
-- code (webhook, admin approval) via SECURITY DEFINER functions below — there
-- is no client insert path, matching the pattern every other table here uses.
-- ---------------------------------------------------------------------------

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id),
  type       text not null check (type in (
               'submission_approved', 'card_sold', 'card_redeemed', 'payout_sent'
             )),
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on notifications (user_id) where read_at is null;

alter table notifications enable row level security;

drop policy if exists notifications_own_read on notifications;
create policy notifications_own_read on notifications
  for select using (user_id = fn_current_user_id());

-- No insert/update policy for authenticated — writes are server-side only,
-- through fn_notify() below and the mark-read function.

create or replace function fn_notify(
  p_user uuid, p_type text, p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  insert into notifications (user_id, type, payload)
  values (p_user, p_type, p_payload)
  returning id into v_id;
  return v_id;
end $$;

comment on function fn_notify(uuid, text, jsonb) is
  'Internal. Called from the same code paths that send the matching email, '
  'so email and in-app notification cannot drift apart the way email and the '
  'dashboard already did once today.';

revoke execute on function fn_notify(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function fn_notify(uuid, text, jsonb) to service_role;

create or replace function fn_mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_user uuid;
begin
  select user_id into v_user from notifications where id = p_id;
  if v_user is null then
    raise exception 'notification % not found', p_id;
  end if;
  if v_user is distinct from fn_current_user_id() then
    raise exception 'not your notification';
  end if;
  update notifications set read_at = now() where id = p_id and read_at is null;
end $$;

revoke execute on function fn_mark_notification_read(uuid) from public, anon;
grant  execute on function fn_mark_notification_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Retire a card without touching the ledger
--
-- ledger_no_update blocks deletes structurally — this does not try to work
-- around that. It cancels any live listing, then marks the card burned,
-- exactly what was done by hand earlier via direct SQL. This is that same
-- operation, made real and admin-gated.
-- ---------------------------------------------------------------------------

create or replace function fn_burn_card(p_card_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin uuid;
  v_card  cards%rowtype;
begin
  v_admin := fn_require_admin();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to retire a card';
  end if;

  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'card % not found', p_card_id; end if;
  if v_card.status = 'burned' then
    raise exception 'card % is already burned', p_card_id;
  end if;
  if v_card.status = 'pending_vault' then
    raise exception
      'card % is pending_vault — resolve the vault intake first, do not burn '
      'a card mid-transit', p_card_id;
  end if;

  update listings set status = 'cancelled'
   where card_id = p_card_id and status in ('early_access', 'public');

  update cards set status = 'burned' where id = p_card_id;

  comment on table cards is 'burn reasons are not columnar yet; if you need to '
    'query them later, add a retired_reason text column rather than parsing '
    'this comment';
end $$;

revoke execute on function fn_burn_card(uuid, text) from public, anon;
grant  execute on function fn_burn_card(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Archive a SKU model — only if it has zero transaction history
--
-- Not proposed by track/data; added here because track/admin's report calls
-- archiveSkuModel() -> fn_archive_sku_model, which had nothing behind it.
--
-- Checked against the LEDGER, not just current card count, per the same
-- discipline 027's fn_ensure_sku_variant and friends already use: a model
-- that ever had a card minted against it — even if that card is now burned —
-- keeps real history and must not be archived. Only a model that was created
-- and never used at all is eligible.
-- ---------------------------------------------------------------------------

alter table sku_models add column if not exists archived_at timestamptz;

create or replace function fn_archive_sku_model(p_model_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_minted_ever integer;
begin
  perform fn_require_admin();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to archive a model';
  end if;

  if not exists (select 1 from sku_models where id = p_model_id) then
    raise exception 'sku_model % not found', p_model_id;
  end if;

  select count(*) into v_minted_ever
  from ledger_entries le
  join cards c on c.id = le.card_id
  join skus s on s.id = c.sku_id
  where s.model_id = p_model_id
    and le.entry_type = 'mint';

  if v_minted_ever > 0 then
    raise exception
      'sku_model % has % card(s) minted against it, including any since '
      'burned — real transaction history, cannot be archived', p_model_id,
      v_minted_ever;
  end if;

  update sku_models set archived_at = now() where id = p_model_id;
end $$;

revoke execute on function fn_archive_sku_model(uuid, text) from public, anon;
grant  execute on function fn_archive_sku_model(uuid, text) to authenticated;

-- listSkuModels and the market grid should exclude archived_at is not null —
-- that is an app-layer filter change, not a migration concern, and is called
-- out in the follow-up notes below.

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
    group by proname having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '028: % function(s) now have multiple arities', v_dupes;
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'users'
                   and column_name = 'stripe_connect_account_id'
                   and data_type = 'text') then
    raise exception '028: stripe_connect_account_id is not text';
  end if;

  raise notice '028 ok: connect columns, notifications, fn_burn_card, fn_archive_sku_model';
end $$;

commit;

-- ============================================================================
-- AFTER RUNNING:
--
--   1. Confirm no anon leak:
--      select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname='public'
--        and p.proname in ('fn_notify','fn_mark_notification_read',
--                          'fn_burn_card','fn_archive_sku_model');
--      Expect fn_notify: false for every role except service_role. The other
--      three: false for anon, true for authenticated.
--
--   2. Then, and only then, merge in this order:
--        merge-track.bat data    (already has the contract exports)
--        merge-track.bat admin
--        merge-track.bat market
--      Watch the test count after EACH ONE — it must go up each time, not
--      just at the end. If any merge reports the same count as before it,
--      that branch was stale against the one before it and needs rebasing,
--      not merging blind.
--
--   3. archiveSkuModel needs listSkuModels to exclude archived_at is not null
--      — that is a track/data follow-up, not covered here.
--
--   4. Before trusting Connect payouts with a real transfer: run
--      processAllDuePayouts() against a Stripe TEST account first, confirm
--      it refuses when any of the three conditions is unmet, confirm it
--      succeeds only when all three are met. Do not point it at a real
--      consignor until that's been watched happen once.
-- ============================================================================