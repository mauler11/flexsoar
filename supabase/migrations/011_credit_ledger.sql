-- ============================================================
-- FlexSoar — 011_credit_ledger.sql
-- RUN IN TWO PARTS. Postgres will not let PART 2 use enum values
-- added in the same transaction, so run PART 1 alone, then PART 2.
-- Both "Run without RLS".
-- ============================================================
-- FSC credit: a one-way, closed-loop store credit.
--
-- THE DESIGN RULE, and the reason this is store credit rather than
-- e-money: credit can ONLY ever pay a seller who has elected to be paid
-- in credit. A seller who wants money is paid money, by Stripe, from the
-- buyer. Credit never becomes money for anyone, at any point, including
-- for the platform on a user's behalf.
--
-- There is deliberately NO fn_withdraw_credit, no fn_convert_credit, and
-- no admin path that pays cash against a credit balance. That absence is
-- the whole compliance position. If someone later adds one "just for
-- support cases", the instrument changes character and the licensing
-- analysis changes with it. Do not add one.
--
-- The risky leg — a seller handing over a physical good and receiving
-- credit instead of money — is isolated behind ONE config flag,
-- credit_payout_enabled. Setting it false disables credit listings
-- entirely with no code deploy, leaving cash-only Stripe settlement.
-- That is the switch to reach for if counsel says the leg needs a
-- licence.
-- ============================================================


-- ============================================================
-- PART 1 — run this alone, first.
-- ============================================================

alter type asset_class        add value if not exists 'credit';
alter type ledger_entry_type  add value if not exists 'credit_purchase';
alter type ledger_entry_type  add value if not exists 'credit_sale_gross';
alter type ledger_entry_type  add value if not exists 'credit_sale_net';
alter type ledger_entry_type  add value if not exists 'credit_sale_fee';


-- ============================================================
-- PART 2 — run this after PART 1 has committed.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Platform config
--    Also gives REDEMPTION_HANDLING_FEE_CENTS the home it has been
--    missing (docs/handoff/data.md).
-- ------------------------------------------------------------

create table if not exists platform_config (
  key        text primary key,
  num_value  bigint,
  bool_value boolean,
  note       text not null,
  updated_at timestamptz not null default now()
);

insert into platform_config (key, num_value, bool_value, note) values
  ('redemption_handling_fee_cents', 1500, null,
   'USD cents charged to ship a redeemed item.'),
  ('credit_payout_enabled', null, true,
   'Master switch for the seller-takes-credit leg. False = cash-only settlement.'),
  ('credit_payout_premium_bps', 500, null,
   'Bonus credit a seller receives for electing credit over cash. 500 = 5%.'),
  ('credit_purchase_min_cents', 500, null,
   'Smallest FSC top-up.')
on conflict (key) do nothing;

alter table platform_config enable row level security;
create policy config_read on platform_config for select using (true);
create policy config_admin_write on platform_config for all
  using (fn_is_admin()) with check (fn_is_admin());

create or replace function fn_config_num(p_key text)
returns bigint language sql stable as $$
  select num_value from platform_config where key = p_key;
$$;

create or replace function fn_config_bool(p_key text)
returns boolean language sql stable as $$
  select bool_value from platform_config where key = p_key;
$$;

-- ------------------------------------------------------------
-- 2. Credit entries must net to zero, exactly like currency.
--    The platform account is the counterparty on issuance, so the
--    platform's (negative) credit balance IS total outstanding user
--    credit — your liability figure, for free.
-- ------------------------------------------------------------

create or replace function trg_ledger_credit_balanced() returns trigger
language plpgsql as $$
declare v_sum bigint;
begin
  select coalesce(sum(amount_cents * direction), 0) into v_sum
  from ledger_entries
  where txn_id = new.txn_id and asset = 'credit';
  if v_sum <> 0 then
    raise exception 'txn % credit entries do not net to zero (got %)',
      new.txn_id, v_sum;
  end if;
  return null;
end $$;

create constraint trigger ledger_credit_balanced
  after insert on ledger_entries
  deferrable initially deferred
  for each row execute function trg_ledger_credit_balanced();

create or replace function fn_credit_balance(p_user uuid)
returns bigint language sql stable as $$
  select coalesce(sum(amount_cents * direction), 0)::bigint
  from ledger_entries
  where account_id = p_user and asset = 'credit';
$$;

grant execute on function fn_credit_balance(uuid) to authenticated;

-- Total credit outstanding. Watch this number; it is what you owe in
-- goods if every holder spent at once.
create or replace function fn_credit_liability()
returns bigint language sql stable as $$
  select coalesce(-sum(amount_cents * direction), 0)::bigint
  from ledger_entries
  where is_platform and asset = 'credit';
$$;

-- ------------------------------------------------------------
-- 3. Sellers elect their payout at listing time
-- ------------------------------------------------------------

do $$ begin
  create type payout_method as enum ('cash', 'credit');
exception when duplicate_object then null;
end $$;

alter table listings
  add column if not exists payout_method payout_method not null default 'cash';

-- ------------------------------------------------------------
-- 4. Buying credit — cash in
--    Service-role only: called from the Stripe webhook AFTER the
--    payment has settled, exactly like fn_purchase_card.
-- ------------------------------------------------------------

create or replace function fn_purchase_credit(
  p_user_id uuid, p_cents bigint, p_settlement_ref text)
returns uuid language plpgsql security definer as $$
declare
  v_txn uuid := gen_random_uuid();
  v_min bigint;
begin
  if p_cents <= 0 then
    raise exception 'credit purchase must be positive, got %', p_cents;
  end if;

  v_min := coalesce(fn_config_num('credit_purchase_min_cents'), 0);
  if p_cents < v_min then
    raise exception 'minimum top-up is % cents, got %', v_min, p_cents;
  end if;

  if exists (select 1 from ledger_entries
             where settlement_ref = p_settlement_ref
               and entry_type = 'credit_purchase') then
    return null;   -- idempotent on Stripe redelivery
  end if;

  insert into ledger_entries
    (txn_id, entry_type, asset, account_id, is_platform,
     amount_cents, direction, settlement_ref) values
    (v_txn, 'credit_purchase', 'credit', p_user_id, false, p_cents,  1, p_settlement_ref),
    (v_txn, 'credit_purchase', 'credit', null,      true,  p_cents, -1, p_settlement_ref);

  return v_txn;
end $$;

revoke execute on function fn_purchase_credit(uuid, bigint, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Buying a card with credit
--    Only permitted where the SELLER elected credit. A cash listing
--    cannot be bought with credit, and a credit listing cannot be
--    bought with cash. That is what keeps the loop closed: credit
--    never has to be converted into money for anyone.
-- ------------------------------------------------------------

create or replace function fn_purchase_card_with_credit(
  p_listing_id uuid, p_buyer_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_l         listings%rowtype;
  v_card      cards%rowtype;
  v_buyer_lvl smallint;
  v_fee_bps   smallint;
  v_fee       bigint;
  v_bonus     bigint;
  v_net       bigint;
  v_platform  bigint;
  v_balance   bigint;
  v_txn       uuid := gen_random_uuid();
  v_order     uuid;
begin
  if coalesce(fn_config_bool('credit_payout_enabled'), false) is not true then
    raise exception 'credit settlement is disabled';
  end if;

  select * into v_l from listings where id = p_listing_id for update;
  if not found then raise exception 'listing % not found', p_listing_id; end if;
  if v_l.status not in ('early_access', 'public') then
    raise exception 'listing % is %', p_listing_id, v_l.status;
  end if;
  if v_l.payout_method <> 'credit' then
    raise exception 'listing % settles in cash and cannot be bought with credit',
      p_listing_id;
  end if;
  if v_l.seller_id = p_buyer_id then
    raise exception 'cannot buy your own listing';
  end if;

  select * into v_card from cards where id = v_l.card_id for update;

  select level into v_buyer_lvl from users where id = p_buyer_id;
  if now() < v_l.public_at and coalesce(v_buyer_lvl, 1) < v_l.early_access_level then
    raise exception 'listing % is in early access until %', p_listing_id, v_l.public_at;
  end if;

  v_balance := fn_credit_balance(p_buyer_id);
  if v_balance < v_l.price_cents then
    raise exception 'insufficient credit: balance %, price %',
      v_balance, v_l.price_cents;
  end if;

  select l.seller_fee_bps into v_fee_bps
  from users u join levels l on l.level = u.level where u.id = v_l.seller_id;

  v_fee      := floor(v_l.price_cents * v_fee_bps / 10000.0);
  v_bonus    := floor(v_l.price_cents
                      * coalesce(fn_config_num('credit_payout_premium_bps'), 0)
                      / 10000.0);
  v_net      := v_l.price_cents - v_fee + v_bonus;
  v_platform := v_l.price_cents - v_net;   -- may be negative when bonus > fee

  insert into orders (listing_id, card_id, buyer_id, seller_id, gross_cents,
                      fee_bps, fee_cents, net_cents, settlement_ref, status, txn_id)
  values (p_listing_id, v_l.card_id, p_buyer_id, v_l.seller_id, v_l.price_cents,
          v_fee_bps, v_fee, v_net, 'credit:' || v_txn::text, 'settled', v_txn)
  returning id into v_order;

  insert into ledger_entries
    (txn_id, entry_type, asset, account_id, is_platform, amount_cents, direction) values
    (v_txn, 'credit_sale_gross', 'credit', p_buyer_id,   false, v_l.price_cents, -1),
    (v_txn, 'credit_sale_net',   'credit', v_l.seller_id, false, v_net,           1),
    (v_txn, 'credit_sale_fee',   'credit', null,          true,  abs(v_platform),
       case when v_platform >= 0 then 1 else -1 end);

  insert into ledger_entries
    (txn_id, entry_type, asset, account_id, card_id, direction) values
    (v_txn, 'card_transfer', 'card', v_l.seller_id, v_l.card_id, -1),
    (v_txn, 'card_transfer', 'card', p_buyer_id,    v_l.card_id,  1);

  update cards set owner_id = p_buyer_id, status = 'active' where id = v_l.card_id;

  update card_provenance
     set released_at = now(), price_cents = v_l.price_cents
   where card_id = v_l.card_id and owner_id = v_l.seller_id and released_at is null;

  insert into card_provenance (card_id, owner_id, owner_level, acquired_at, price_cents)
  values (v_l.card_id, p_buyer_id, coalesce(v_buyer_lvl, 1), now(), v_l.price_cents);

  update listings set status = 'sold', sold_at = now() where id = p_listing_id;

  perform fn_award_xp(p_buyer_id,   'purchase', greatest(10, v_l.price_cents / 1000), v_order);
  perform fn_award_xp(v_l.seller_id, 'sale',    greatest(10, v_l.price_cents / 1000), v_order);

  return v_order;
end $$;

grant execute on function fn_purchase_card_with_credit(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Follow-ups deliberately NOT in this migration
--    - fn_redeem_card still charges its handling fee in currency.
--      Once credit is live it should read the fee from
--      redemption_handling_fee_cents and accept credit.
--    - fn_list_card does not yet set payout_method; it defaults to
--      'cash'. The contract needs an argument for it.
-- ------------------------------------------------------------
