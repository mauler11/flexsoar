-- 021_credit_holds.sql
--
-- RUN 018, 019a, 019b, 019c AND 020 FIRST.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- 019c let a buyer settle partly in FSC and partly in cash, but it checks the
-- FSC balance at settlement time. Settlement happens in the Stripe webhook,
-- minutes after the buyer committed. Between those two moments the same FSC can
-- be spent somewhere else:
--
--   buyer holds 400 FSC, starts a 500 checkout as 400 FSC + 100 cash
--   -> in another tab, buys a 400 card entirely in FSC. Succeeds.
--   -> webhook fires, finds 0 FSC, raises. The 100 has already been taken.
--
-- FSC is therefore reserved when the purchase intent is created - by the
-- session client, whose identity is verifiable - and merely consumed at
-- settlement.
--
-- The same mechanism closes an authorisation gap. fn_purchase_card_core is
-- SECURITY DEFINER with no check that the caller is the buyer. That was
-- tolerable while every credit purchase came from a session; it is not
-- tolerable now that the split path runs on service_role, where p_buyer_id is
-- whatever the caller says. After this migration, spending FSC requires either
-- a verified session matching p_buyer_id, or a hold that was created by one.
--
-- Also closes fn_purchase_credit for service_role. It was revoked from anon and
-- authenticated in 019b, which left the webhook - the one client that bypasses
-- RLS - still able to mint FSC for cash.
--
-- Safe to re-run.

begin;

-- 1. Holds ------------------------------------------------------------------

create table if not exists credit_holds (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references users(id),
  listing_id   uuid        not null references listings(id),
  amount_cents bigint      not null check (amount_cents > 0),
  status       text        not null default 'active'
                 check (status in ('active','consumed','released','expired')),
  expires_at   timestamptz not null,
  order_id     uuid        references orders(id),
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz,
  released_at  timestamptz
);

comment on table credit_holds is
  'FSC committed to an in-flight purchase. Created by the session client at '
  'checkout intent, consumed by the webhook at settlement. Spendable balance '
  'is fn_credit_available, never fn_credit_balance.';

create unique index if not exists credit_holds_active_uidx
  on credit_holds (user_id, listing_id) where status = 'active';

create index if not exists credit_holds_expiry_idx
  on credit_holds (expires_at) where status = 'active';

alter table credit_holds enable row level security;

drop policy if exists credit_holds_own_read on credit_holds;
create policy credit_holds_own_read on credit_holds
  for select using (user_id = fn_current_user_id() or fn_is_admin());


-- 2. Available balance ------------------------------------------------------

create or replace function fn_expire_credit_holds()
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  with x as (
    update credit_holds
       set status = 'expired', released_at = now()
     where status = 'active' and expires_at <= now()
     returning 1
  ) select count(*)::integer from x;
$function$;

create or replace function fn_credit_held(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(sum(amount_cents), 0)::bigint
    from credit_holds
   where user_id = p_user
     and status = 'active'
     and expires_at > now();
$function$;

create or replace function fn_credit_available(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select fn_credit_balance(p_user) - fn_credit_held(p_user);
$function$;

comment on function fn_credit_available(uuid) is
  'Spendable FSC. Every UI surface and every pre-purchase check must use this, '
  'not fn_credit_balance - the difference is money already committed to an '
  'in-flight checkout.';


-- 3. Reserve ----------------------------------------------------------------
-- Session client only. fn_current_user_id() is null under service_role, so the
-- webhook cannot mint itself a hold.

create or replace function fn_reserve_credit(p_listing_id uuid, p_credit_cents bigint)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user      uuid;
  v_l         listings%rowtype;
  v_available bigint;
  v_minutes   bigint;
  v_hold      uuid;
begin
  v_user := fn_current_user_id();
  if v_user is null then
    raise exception 'sign in to reserve FSC';
  end if;

  if p_credit_cents is null or p_credit_cents <= 0 then
    raise exception 'reserve amount must be positive';
  end if;

  perform fn_expire_credit_holds();

  select * into v_l from listings where id = p_listing_id;
  if not found then
    raise exception 'listing % not found', p_listing_id;
  end if;
  if v_l.status not in ('early_access','public') then
    raise exception 'listing % is %', p_listing_id, v_l.status;
  end if;
  if v_l.seller_id = v_user then
    raise exception 'cannot buy your own listing';
  end if;
  if p_credit_cents > v_l.price_cents then
    raise exception 'reserve of % exceeds listing price %',
      p_credit_cents, v_l.price_cents;
  end if;

  -- Serialise the holder so two concurrent intents cannot both reserve the
  -- same FSC.
  perform 1 from users where id = v_user for update;

  v_available := fn_credit_available(v_user);
  if v_available < p_credit_cents then
    raise exception 'insufficient available FSC: % available, % requested',
      v_available, p_credit_cents;
  end if;

  update credit_holds
     set status = 'released', released_at = now()
   where user_id = v_user and listing_id = p_listing_id and status = 'active';

  v_minutes := coalesce(fn_config_num('credit_hold_minutes'), 30);

  insert into credit_holds (user_id, listing_id, amount_cents, expires_at)
  values (v_user, p_listing_id, p_credit_cents,
          now() + make_interval(mins => v_minutes::int))
  returning id into v_hold;

  return v_hold;
end;
$function$;


create or replace function fn_release_credit_hold(p_hold_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_h credit_holds%rowtype;
begin
  select * into v_h from credit_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold % not found', p_hold_id;
  end if;
  if v_h.user_id is distinct from fn_current_user_id() and not fn_is_admin() then
    raise exception 'hold % does not belong to you', p_hold_id;
  end if;
  if v_h.status <> 'active' then
    return;
  end if;

  update credit_holds
     set status = 'released', released_at = now()
   where id = p_hold_id;
end;
$function$;


-- 4. Settlement now demands provenance for FSC ------------------------------
-- Postgres treats a new default argument as an overload rather than a
-- replacement, so the four-argument forms must be dropped or every call
-- becomes ambiguous.

drop function if exists fn_purchase_card(uuid, uuid, text, bigint);
drop function if exists fn_purchase_card_core(uuid, uuid, text, bigint);

create or replace function fn_purchase_card_core(
  p_listing_id     uuid,
  p_buyer_id       uuid,
  p_settlement_ref text,
  p_credit_cents   bigint default 0,
  p_hold_id        uuid   default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_l           listings%rowtype;
  v_card        cards%rowtype;
  v_hold        credit_holds%rowtype;
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

  perform 1 from users where id = p_buyer_id for update;

  v_price  := v_l.price_cents;
  v_credit := least(greatest(coalesce(p_credit_cents, 0), 0), v_price);

  if v_credit > 0 then
    if coalesce(fn_config_bool('credit_payout_enabled'), false) is not true then
      raise exception 'FSC settlement is disabled';
    end if;

    -- Provenance. Either a verified session that IS the buyer, or a hold that
    -- was created by one. service_role has no auth.uid() and so cannot spend
    -- another user's FSC without a hold they themselves made.
    if p_hold_id is not null then
      select * into v_hold from credit_holds where id = p_hold_id for update;
      if not found then
        raise exception 'credit hold % not found', p_hold_id;
      end if;
      if v_hold.status <> 'active' then
        raise exception 'credit hold % is %', p_hold_id, v_hold.status;
      end if;
      if v_hold.expires_at <= now() then
        update credit_holds set status = 'expired', released_at = now()
         where id = p_hold_id;
        raise exception 'credit hold % expired at %', p_hold_id, v_hold.expires_at;
      end if;
      if v_hold.user_id <> p_buyer_id then
        raise exception 'credit hold % belongs to another user', p_hold_id;
      end if;
      if v_hold.listing_id <> p_listing_id then
        raise exception 'credit hold % is for a different listing', p_hold_id;
      end if;
      if v_hold.amount_cents < v_credit then
        raise exception 'credit hold % covers only % of % requested',
          p_hold_id, v_hold.amount_cents, v_credit;
      end if;
    elsif fn_current_user_id() is distinct from p_buyer_id then
      raise exception 'spending FSC requires a session matching the buyer, or a credit hold';
    end if;

    v_balance := fn_credit_balance(p_buyer_id);
    if v_balance < v_credit then
      raise exception 'insufficient FSC: balance %, requested %', v_balance, v_credit;
    end if;
  end if;

  v_cash := v_price - v_credit;

  if v_cash > 0 and coalesce(btrim(p_settlement_ref), '') = '' then
    raise exception 'a cash leg of % cents requires a settlement_ref', v_cash;
  end if;

  v_ref := coalesce(nullif(btrim(p_settlement_ref), ''), 'fsc:' || v_txn::text);

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

  if p_hold_id is not null then
    update credit_holds
       set status = 'consumed', consumed_at = now(), order_id = v_order
     where id = p_hold_id;
  end if;

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


create or replace function fn_purchase_card(
  p_listing_id     uuid,
  p_buyer_id       uuid,
  p_settlement_ref text,
  p_credit_cents   bigint default 0,
  p_hold_id        uuid   default null
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

  return fn_purchase_card_core(p_listing_id, p_buyer_id, p_settlement_ref,
                               p_credit_cents, p_hold_id);

exception
  when unique_violation then
    select id into v_existing from orders where settlement_ref = p_settlement_ref;
    if v_existing is null then
      raise;
    end if;
    return v_existing;
end;
$function$;


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
  -- No hold: this is the direct session path, so the identity check inside
  -- core applies and service_role cannot reach it.
  return fn_purchase_card_core(p_listing_id, p_buyer_id, null, v_price, null);
end;
$function$;


-- 5. Close the top-up for real ----------------------------------------------
-- 019b revoked anon and authenticated. service_role bypasses RLS and kept the
-- grant, so the Stripe webhook's credit_topup branch still worked.

revoke execute on function fn_purchase_credit(uuid, bigint, text) from service_role;

comment on function fn_purchase_credit(uuid, bigint, text) is
  'REVOKED from every role as of 021. Selling FSC for cash makes it prepaid '
  'stored value and produces top-up charges that are indefensible in a '
  'chargeback. FSC is earned by selling, never bought. The Stripe webhook''s '
  'credit_topup branch must be deleted; this revoke only stops it succeeding.';


-- 6. Payout method is self-or-admin -----------------------------------------
-- Anyone could previously read anyone's payout method, which leaks their
-- country.

create or replace function fn_payout_method_for_user(p_user uuid)
returns payout_method
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := fn_current_user_id();
begin
  if v_caller is not null
     and v_caller is distinct from p_user
     and not fn_is_admin() then
    raise exception 'payout method is visible only to its owner';
  end if;

  return case
           when exists (
             select 1 from users u
             join cash_payout_countries c
               on c.country_code = upper(btrim(u.country_code))
             where u.id = p_user
           )
           then 'cash'::payout_method
           else 'credit'::payout_method
         end;
end;
$function$;


-- 7. Config -----------------------------------------------------------------

insert into platform_config (key, num_value, bool_value, note) values
  ('credit_hold_minutes', 30, null,
   'How long FSC stays reserved for an in-flight checkout before the hold '
   'expires and the balance is spendable again. Must comfortably exceed the '
   'worst-case Stripe webhook delay.')
on conflict (key) do nothing;


-- 8. Grants -----------------------------------------------------------------

grant execute on function fn_reserve_credit(uuid, bigint)      to authenticated;
grant execute on function fn_release_credit_hold(uuid)         to authenticated;
grant execute on function fn_credit_available(uuid)            to authenticated;
grant execute on function fn_credit_held(uuid)                 to authenticated;
grant execute on function fn_expire_credit_holds()             to authenticated;
grant execute on function fn_purchase_card(uuid, uuid, text, bigint, uuid) to authenticated;
grant select on credit_holds to authenticated;

revoke execute on function fn_purchase_card_core(uuid, uuid, text, bigint, uuid) from anon;
revoke execute on function fn_purchase_card_core(uuid, uuid, text, bigint, uuid) from authenticated;

commit;
