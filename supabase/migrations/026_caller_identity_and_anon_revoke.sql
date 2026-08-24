-- ============================================================================
-- 026_caller_identity_and_anon_revoke.sql
--
-- TWO PROBLEMS, found in a pre-deployment audit 2026-08-24.
--
-- 1. THREE FUNCTIONS TRUST A CALLER-SUPPLIED IDENTITY ARGUMENT
--
--    fn_redeem_card(p_card_id, p_user_id, ...)  checks v_card.owner_id <> p_user_id
--    fn_list_card(p_card_id, p_seller_id, ...)  checks v_card.owner_id <> p_seller_id
--    fn_cancel_listing(p_listing_id, p_actor)   checks v_l.seller_id <> p_actor
--
--    Each compares the row's owner against an argument the CALLER chose. Pass
--    the real owner's id and the check passes. All three are SECURITY DEFINER.
--
--    Worst case is fn_redeem_card: any signed-in user can burn another user's
--    card and create a redemption carrying THEIR OWN shipping address, with
--    the handling fee debited from the victim. That is a physical shoe
--    redirected to an attacker. fn_list_card lets you list someone else's card
--    at any price; fn_cancel_listing lets you pull any live listing.
--
--    This is NOT an anon-only issue — `authenticated` can do all of it too, so
--    revoking the grant alone would not fix it. The identity has to come from
--    the session.
--
-- 2. 29 fn_* FUNCTIONS ARE STILL EXECUTABLE BY anon
--
--    022b revoked a targeted list of 13 and set `alter default privileges`,
--    but that only affects functions created AFTERWARDS. Everything older kept
--    its default PUBLIC grant, and PUBLIC includes anon.
--
--    Most refuse in the body (fn_require_admin, and now the three above), so
--    the grant is defence in depth rather than the only wall. But an
--    unauthenticated caller has no business reaching any of them.
--
-- SCOPE, deliberately narrow: this revokes from PUBLIC and anon only, and
-- leaves every `authenticated` grant exactly as it is. Over-revoking would
-- break signed-in flows that are hard to test before deployment, and the
-- anonymous surface is the actual exposure. Trigger functions are revoked from
-- authenticated too — nothing should call those directly.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Derive identity from the session
--
-- Same carve-out shape as 022c: a real client session must prove ownership;
-- service_role and session-less callers (migrations, the smoke script's
-- fixtures) pass through, since they are already trusted contexts.
-- ---------------------------------------------------------------------------
create or replace function fn_require_actor(p_claimed uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_claims text;
  v_role   text;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  if v_claims is null then
    return;  -- migrations, psql, the webhook
  end if;

  begin
    v_role := coalesce(v_claims::jsonb ->> 'role', '');
  exception when others then
    raise exception 'not authorised: session claims could not be read';
  end;

  if v_role not in ('anon', 'authenticated') then
    return;  -- service_role
  end if;

  if fn_current_user_id() is distinct from p_claimed and not fn_is_admin() then
    raise exception 'not authorised to act as another user';
  end if;
end $$;

comment on function fn_require_actor(uuid) is
  'For functions that take a user id as an argument. Confirms a real client '
  'session actually IS that user, or is an admin. Without this the argument '
  'is a claim the caller makes about themselves, not a fact.';

revoke execute on function fn_require_actor(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. fn_redeem_card — the severe one
-- ---------------------------------------------------------------------------
create or replace function fn_redeem_card(
  p_card_id uuid, p_user_id uuid, p_address jsonb, p_fee_cents integer
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card cards%rowtype;
  v_item items%rowtype;
  v_txn  uuid := gen_random_uuid();
  v_red  uuid;
  v_days bigint;
begin
  -- ADDED 026: p_user_id was taken on trust, so anyone could redeem anyone
  -- else's card to their own address.
  perform fn_require_actor(p_user_id);

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

-- ---------------------------------------------------------------------------
-- 3. fn_list_card
-- ---------------------------------------------------------------------------
create or replace function fn_list_card(
  p_card_id uuid, p_seller_id uuid, p_price_cents integer
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card    cards%rowtype;
  v_minutes smallint;
  v_level   smallint;
  v_oracle  integer;
  v_listing uuid;
begin
  -- ADDED 026: p_seller_id was taken on trust.
  perform fn_require_actor(p_seller_id);

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
end $$;

-- ---------------------------------------------------------------------------
-- 4. fn_cancel_listing
-- ---------------------------------------------------------------------------
create or replace function fn_cancel_listing(p_listing_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_l listings%rowtype;
begin
  -- ADDED 026: p_actor was taken on trust, so anyone could cancel any listing.
  perform fn_require_actor(p_actor);

  select * into v_l from listings where id = p_listing_id for update;
  if v_l.seller_id <> p_actor then raise exception 'not your listing'; end if;
  if v_l.status not in ('early_access','public') then
    raise exception 'listing % is %', p_listing_id, v_l.status;
  end if;
  update listings set status = 'cancelled' where id = p_listing_id;
  update cards set status = 'active' where id = v_l.card_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Close the anonymous surface
--
-- Revokes from PUBLIC (where the default grant lives) and anon, across every
-- fn_*. `authenticated` grants are untouched — over-revoking would break
-- signed-in flows that cannot be tested before deployment, and anon is the
-- exposure.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;

-- Trigger functions: nothing should call these directly, ever.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_function_result(p.oid) = 'trigger'
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes int;
  v_anon  text;
  v_trig  text;
begin
  select count(*) into v_dupes from (
    select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and proname like 'fn\_%'
    group by proname having count(*)>1) d;
  if v_dupes > 0 then
    raise exception '026: % function(s) now have multiple arities', v_dupes;
  end if;

  select string_agg(p.proname, ', ') into v_anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname like 'fn\_%'
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_anon is not null then
    raise exception '026: anon can still execute %', v_anon;
  end if;

  select string_agg(p.proname, ', ') into v_trig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and pg_get_function_result(p.oid) = 'trigger'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_trig is not null then
    raise exception '026: trigger function(s) still directly callable: %', v_trig;
  end if;

  raise notice '026 ok: caller identity enforced on redeem/list/cancel, anon surface closed';
end $$;

commit;

-- ============================================================================
-- NOTE for the smoke script: fn_require_actor lets session-less callers
-- through, so scripts/smoke_settlement.sql keeps working unchanged. Its V1
-- section expects fn_list_card and fn_redeem_card to REFUSE a pending_vault
-- card; they still do, on the status check, which runs after the actor check.
-- Re-run it to confirm.
-- ============================================================================
