-- ============================================================================
-- FlexSoar — settlement smoke script
-- scripts/smoke_settlement.sql
--
-- Puts one real purchase through each quadrant of the settlement matrix
-- against live SQL (019c + 021), asserts the platform identity after every
-- one, and exercises hold expiry. Wrapped in BEGIN ... ROLLBACK: nothing
-- persists. Safe to run against the live project.
--
-- RUN IN: Supabase SQL editor, "Run without RLS" (postgres role).
--         Buyer-identity steps impersonate inside the transaction.
--
-- FAILURE MODE: any assert raises and the whole transaction unwinds. The
-- exception message tells you which quadrant and which invariant.
--
-- Quadrants (buyer settlement x seller payout):
--   Q1  buyer cash  -> seller cash    money passes through
--   Q2  buyer cash  -> seller credit  pool grows, FSC issued
--   Q3  buyer FSC   -> seller cash    pool drains, FSC burned
--   Q4  buyer FSC   -> seller credit  FSC changes hands
--   Q5  buyer both  -> seller cash    partial settlement
--   Q6  hold expiry (no purchase)
--
-- NOTE: Q3/Q4/Q5 spend FSC that Q2 issued. There is no top-up, so the chain
-- is the only way a test buyer can hold FSC. Do not reorder.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- PREFLIGHT — fail loudly before doing any work
-- ---------------------------------------------------------------------------
do $$
declare
  v_dupes int;
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
  raise notice 'PREFLIGHT ok: no arity duplicates';
end $$;

-- ---------------------------------------------------------------------------
-- FIXTURES
-- ---------------------------------------------------------------------------
create temporary table _ids (k text primary key, v uuid) on commit drop;
create temporary table _log  (step text, note text) on commit drop;
create temporary table _base (currency bigint, liability bigint,
                              commission bigint) on commit drop;

do $$
declare
  u_seller_my uuid := gen_random_uuid();
  u_seller_us uuid := gen_random_uuid();
  u_buyer_a   uuid := gen_random_uuid();
  u_buyer_b   uuid := gen_random_uuid();
  u_admin     uuid := gen_random_uuid();
  v_sku       uuid;
  v_tag       text := substr(replace(gen_random_uuid()::text,'-',''),1,8);
begin
  -- auth.users rows, only if users.auth_id actually references them.
  -- Non-fatal: if the insert is not possible, the FK probably does not exist.
  begin
    if to_regclass('auth.users') is not null then
      insert into auth.users (id, email)
      values (u_seller_my, 'smoke.sellermy.'||v_tag||'@example.test'),
             (u_seller_us, 'smoke.sellerus.'||v_tag||'@example.test'),
             (u_buyer_a,   'smoke.buyera.'  ||v_tag||'@example.test'),
             (u_buyer_b,   'smoke.buyerb.'  ||v_tag||'@example.test'),
             (u_admin,     'smoke.admin.'   ||v_tag||'@example.test')
      on conflict (id) do nothing;
    end if;
  exception when others then
    raise notice 'auth.users seed skipped (%). Continuing.', sqlerrm;
  end;

  insert into users (id, auth_id, handle, email, country_code,
                     is_consignor, fulfilments_completed)
  values
    (u_seller_my, u_seller_my, ('smoke_smy_'||v_tag)::text,
       ('smoke.sellermy.'||v_tag||'@example.test')::text, 'MY', true, 5),
    (u_seller_us, u_seller_us, ('smoke_sus_'||v_tag)::text,
       ('smoke.sellerus.'||v_tag||'@example.test')::text, 'US', true, 5),
    (u_buyer_a,   u_buyer_a,   ('smoke_ba_' ||v_tag)::text,
       ('smoke.buyera.' ||v_tag||'@example.test')::text, 'US', false, 0),
    (u_buyer_b,   u_buyer_b,   ('smoke_bb_' ||v_tag)::text,
       ('smoke.buyerb.' ||v_tag||'@example.test')::text, 'SG', false, 0);

  -- fn_grade_item / fn_mint_card / fn_list_card all call fn_require_admin(),
  -- which refuses postgres and service_role alike: superuser is not the same
  -- thing as an authenticated admin. The fixtures impersonate this user.
  insert into users (id, auth_id, handle, email, country_code, is_admin)
  values (u_admin, u_admin, ('smoke_adm_'||v_tag)::text,
       ('smoke.admin.'||v_tag||'@example.test')::text, 'MY', true);

  insert into skus (brand, model, colorway, size_us,
                    retail_price_cents, market_price_cents, priced_at)
  values ('SmokeBrand', 'SmokeModel '||v_tag, 'Test/Colour', 10.0,
          20000, 30000, now())
  returning id into v_sku;

  insert into _ids values
    ('seller_my', u_seller_my), ('seller_us', u_seller_us),
    ('buyer_a',   u_buyer_a),   ('buyer_b',   u_buyer_b),
    ('admin',     u_admin),
    ('sku',       v_sku);

  raise notice 'FIXTURES ok: 5 users (1 admin), 1 sku';
end $$;

-- ---------------------------------------------------------------------------
-- HELPERS — mint a card and put it on a listing with a chosen payout method
-- ---------------------------------------------------------------------------
create or replace function pg_temp.mk_listing(
  p_seller uuid, p_price int, p_payout payout_method
) returns uuid language plpgsql as $$
declare
  v_item uuid; v_card uuid; v_listing uuid; v_sku uuid; v_admin uuid;
begin
  select v into v_sku   from _ids where k = 'sku';
  select v into v_admin from _ids where k = 'admin';

  insert into items (sku_id, consignor_id, status, custody, custody_holder_id,
                     grade_source, submitted_payout, photos, asking_price_cents)
  values (v_sku, p_seller, 'in_custody', 'seller', p_seller,
          'seller_declared', p_payout, '[]'::jsonb, p_price)
  returning id into v_item;

  -- become an authenticated admin: fn_require_admin() reads auth.uid(), which
  -- superuser does not have. Settlement below deliberately runs WITHOUT this.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- fn_mint_card requires authenticated_at, and fn_grade_item only promotes
  -- status when authenticated_at is already set — so authenticate first.
  perform fn_authenticate_item(v_item, 'smoke fixture');

  -- items_grade_components_sum reconciles the six components against
  -- float_value with weights .25/.20/.20/.20/.10/.05, rounded to 3dp. Setting
  -- every component to the target float satisfies it exactly.
  perform fn_grade_item(v_item, 0.120, 'smoke fixture',
                        0.120, 0.120, 0.120, 0.120, 0.120, 0.120);

  v_card := fn_mint_card(v_item, p_seller);
  v_listing := fn_list_card(v_card, p_seller, p_price);

  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- fn_list_card takes no payout argument and listings.payout_method
  -- defaults to 'cash'. Set it explicitly; also clear early-access gating.
  update listings
     set payout_method = p_payout,
         status        = 'public',
         public_at     = now() - interval '1 hour'
   where id = v_listing;

  return v_listing;
end $$;

-- ---------------------------------------------------------------------------
-- HELPERS — the invariants, asserted after every quadrant
-- ---------------------------------------------------------------------------
create or replace function pg_temp.assert_invariants(p_step text)
returns void language plpgsql as $$
declare
  v_platform_currency bigint;
  v_liability         bigint;
  v_commission        bigint;
  v_b_currency        bigint;
  v_b_liability       bigint;
  v_b_commission      bigint;
  v_lhs               bigint;
  v_bad               text;
begin
  -- 1. per-transaction net zero, per asset class, for valued assets
  select string_agg(txn_id::text || '/' || asset::text, ', ')
    into v_bad
  from (
    select txn_id, asset
    from ledger_entries
    where asset <> 'card'
    group by txn_id, asset
    having coalesce(sum(amount_cents * direction), 0) <> 0
  ) x;
  if v_bad is not null then
    raise exception '% : ledger does not net to zero for %', p_step, v_bad;
  end if;

  -- 2. cards are created and destroyed, not conserved, so per-txn netting is
  --    the wrong test. What must hold instead:

  -- 2a. every card is minted exactly once
  select string_agg(card_id::text, ', ') into v_bad
  from (
    select card_id from ledger_entries
    where asset = 'card' and entry_type = 'mint'
    group by card_id having count(*) <> 1
  ) x;
  if v_bad is not null then
    raise exception '% : card minted more than once — %', p_step, v_bad;
  end if;

  -- 2b. a card is held once or not at all. Anything else means a transfer
  --     dropped a leg and duplicated or destroyed someone's property.
  select string_agg(card_id::text || ' (net ' || net || ')', ', ') into v_bad
  from (
    select card_id, coalesce(sum(direction), 0) as net
    from ledger_entries where asset = 'card'
    group by card_id
  ) x where net not in (0, 1);
  if v_bad is not null then
    raise exception '% : card conservation broken — %', p_step, v_bad;
  end if;

  -- 2c. a transfer must net to zero for the card it moves
  select string_agg(txn_id::text || '/' || card_id::text, ', ') into v_bad
  from (
    select txn_id, card_id, coalesce(sum(direction), 0) as net
    from ledger_entries
    where asset = 'card' and entry_type in ('card_transfer', 'trade_fee')
    group by txn_id, card_id
  ) x where net <> 0;
  if v_bad is not null then
    raise exception '% : transfer leg missing in txn/card %', p_step, v_bad;
  end if;

  -- 2d. the ledger is the source of truth for ownership, so cards.owner_id
  --     must agree with the most recent acquiring entry
  select string_agg(card_id::text, ', ') into v_bad
  from (
    select c.id as card_id
    from cards c
    join lateral (
      select le.account_id
      from ledger_entries le
      where le.card_id = c.id and le.asset = 'card' and le.direction = 1
      order by le.id desc limit 1
    ) last_acq on true
    where c.status in ('active', 'locked')
      and last_acq.account_id is distinct from c.owner_id
  ) x;
  if v_bad is not null then
    raise exception
      '% : cards.owner_id disagrees with the ledger for card(s) %',
      p_step, v_bad;
  end if;

  -- 2e. a card the ledger says is gone must not still be live
  select string_agg(card_id::text, ', ') into v_bad
  from (
    select c.id as card_id, coalesce(sum(le.direction), 0) as net
    from cards c
    left join ledger_entries le on le.card_id = c.id and le.asset = 'card'
    group by c.id, c.status
    having (coalesce(sum(le.direction), 0) = 0
            and c.status in ('active', 'locked'))
        or (coalesce(sum(le.direction), 0) = 1
            and c.status in ('burned', 'redeemed'))
  ) x;
  if v_bad is not null then
    raise exception '% : card status contradicts the ledger — %', p_step, v_bad;
  end if;

  -- 3. THE identity, asserted on the DELTA from baseline.
  --
  --    Absolute totals cannot balance on this database: legacy credit_purchase
  --    rows issued FSC with no currency leg (the top-up era), so there is
  --    standing liability with no cash behind it. That is dead-model data, not
  --    a live bug, and reversing it is a separate correcting transaction.
  --
  --    What must hold for anything settled TODAY:
  --      d(platform currency) - d(liability) = d(commission), exactly.
  --    Derivation, per transaction with price P, fee F, net N, credit C, cash H:
  --      d platform currency = H - (N if seller takes cash)
  --      d platform credit   = C - (N if seller takes FSC)
  --      liability = -(platform credit), since the credit class nets to zero
  --    so the left side collapses to H + C - N = P - N = F.
  select coalesce(sum(amount_cents * direction), 0) into v_platform_currency
  from ledger_entries where is_platform and asset = 'currency';

  v_liability := fn_credit_liability();

  select coalesce(sum(fee_cents), 0) into v_commission
  from orders where status <> 'pending';

  if p_step = 'BASELINE' then
    delete from _base;
    insert into _base values (v_platform_currency, v_liability, v_commission);
    insert into _log values (p_step,
      format('snapshot currency=%s liability=%s commission=%s',
             v_platform_currency, v_liability, v_commission));
    raise notice 'BASELINE snapshot — currency % / liability % / commission % '
      '(legacy, not asserted)', v_platform_currency, v_liability, v_commission;
    return;
  end if;

  select currency, liability, commission
    into v_b_currency, v_b_liability, v_b_commission from _base;

  v_lhs := (v_platform_currency - v_b_currency)
         - (v_liability - v_b_liability);

  if v_lhs <> (v_commission - v_b_commission) then
    raise exception
      '% : IDENTITY BROKEN on delta. d(currency) % - d(liability) % = %, '
      'but d(commission) is %. Difference %.',
      p_step,
      v_platform_currency - v_b_currency,
      v_liability - v_b_liability,
      v_lhs,
      v_commission - v_b_commission,
      v_lhs - (v_commission - v_b_commission);
  end if;

  insert into _log values (p_step,
    format('d_currency=%s d_liability=%s d_commission=%s',
           v_platform_currency - v_b_currency,
           v_liability - v_b_liability,
           v_commission - v_b_commission));
  raise notice '% ok — d currency % / d liability % / d commission %',
    p_step,
    v_platform_currency - v_b_currency,
    v_liability - v_b_liability,
    v_commission - v_b_commission;
end $$;

-- baseline: the identity must already hold before we touch anything
select pg_temp.assert_invariants('BASELINE');

-- ---------------------------------------------------------------------------
-- Q1  buyer cash -> seller cash (Malaysian seller). Money passes through.
-- ---------------------------------------------------------------------------
do $$
declare v_listing uuid; v_order uuid; v_seller uuid; v_buyer uuid;
begin
  select v into v_seller from _ids where k = 'seller_my';
  select v into v_buyer  from _ids where k = 'buyer_a';

  v_listing := pg_temp.mk_listing(v_seller, 30000, 'cash');

  -- settled as the webhook does it: no session, cash only, zero credit
  v_order := fn_purchase_card(v_listing, v_buyer, 'smoke_q1_ref', 0, null);
  if v_order is null then raise exception 'Q1: purchase returned null'; end if;

  if (select cash_cents from orders where id = v_order) <> 30000 then
    raise exception 'Q1: cash_cents is not the full price';
  end if;
  if (select credit_cents from orders where id = v_order) <> 0 then
    raise exception 'Q1: credit_cents should be zero';
  end if;
  if fn_credit_balance(v_seller) <> 0 then
    raise exception 'Q1: Malaysian seller was issued FSC and should not have been';
  end if;
end $$;
select pg_temp.assert_invariants('Q1 cash->cash');

-- ---------------------------------------------------------------------------
-- Q2  buyer cash -> seller credit (US seller). Pool grows, FSC issued.
--     This is what funds every FSC spend below.
-- ---------------------------------------------------------------------------
do $$
declare
  v_listing uuid; v_order uuid; v_seller uuid; v_buyer uuid; v_net bigint;
begin
  select v into v_seller from _ids where k = 'seller_us';
  select v into v_buyer  from _ids where k = 'buyer_a';

  v_listing := pg_temp.mk_listing(v_seller, 40000, 'credit');
  v_order := fn_purchase_card(v_listing, v_buyer, 'smoke_q2_ref', 0, null);

  select net_cents into v_net from orders where id = v_order;
  if fn_credit_balance(v_seller) <> v_net then
    raise exception 'Q2: seller FSC is %, expected net %',
      fn_credit_balance(v_seller), v_net;
  end if;
  if fn_credit_available(v_seller) <> v_net then
    raise exception 'Q2: available should equal balance with no holds';
  end if;
end $$;
select pg_temp.assert_invariants('Q2 cash->credit');

-- ---------------------------------------------------------------------------
-- IDEMPOTENCY — replaying Q2's settlement_ref must not double-issue
-- ---------------------------------------------------------------------------
do $$
declare v_before bigint; v_after bigint; v_seller uuid; v_buyer uuid;
        v_listing uuid; v_r uuid;
begin
  select v into v_seller from _ids where k = 'seller_us';
  select v into v_buyer  from _ids where k = 'buyer_a';
  select listing_id into v_listing from orders where settlement_ref = 'smoke_q2_ref';
  v_before := fn_credit_balance(v_seller);

  begin
    v_r := fn_purchase_card(v_listing, v_buyer, 'smoke_q2_ref', 0, null);
  exception when others then
    raise notice 'IDEMPOTENCY: replay raised (%) — acceptable if deliberate', sqlerrm;
  end;

  v_after := fn_credit_balance(v_seller);
  if v_after <> v_before then
    raise exception 'IDEMPOTENCY BROKEN: webhook redelivery moved FSC % -> %',
      v_before, v_after;
  end if;
  raise notice 'IDEMPOTENCY ok — replay did not double-issue';
end $$;
select pg_temp.assert_invariants('IDEMPOTENCY');

-- ---------------------------------------------------------------------------
-- Q3  buyer FSC -> seller cash. Pool drains, FSC burned.
--     seller_us from Q2 is now the buyer; it is the only way to hold FSC.
-- ---------------------------------------------------------------------------
do $$
declare
  v_listing uuid; v_order uuid; v_seller uuid; v_buyer uuid;
  v_hold uuid; v_price int := 25000; v_before bigint;
begin
  select v into v_seller from _ids where k = 'seller_my';
  select v into v_buyer  from _ids where k = 'seller_us';   -- holds FSC from Q2

  v_listing := pg_temp.mk_listing(v_seller, v_price, 'cash');
  v_before  := fn_credit_balance(v_buyer);

  if v_before < v_price then
    raise exception 'Q3: buyer holds % FSC, needs %. Q2 net was too small.',
      v_before, v_price;
  end if;

  -- reserve as the buyer's own session, the way checkout must do it
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_buyer::text, 'role', 'authenticated')::text, true);

  v_hold := fn_reserve_credit(v_listing, v_price);
  if v_hold is null then raise exception 'Q3: reserve_credit returned null'; end if;

  if fn_credit_available(v_buyer) <> v_before - v_price then
    raise exception 'Q3: hold did not reduce available (% vs %)',
      fn_credit_available(v_buyer), v_before - v_price;
  end if;
  if fn_credit_balance(v_buyer) <> v_before then
    raise exception 'Q3: a hold must not change balance, only available';
  end if;

  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- settle as the webhook: service context, carrying the hold
  v_order := fn_purchase_card(v_listing, v_buyer, 'smoke_q3_ref', v_price, v_hold);

  if (select credit_cents from orders where id = v_order) <> v_price then
    raise exception 'Q3: order credit_cents does not match the FSC applied';
  end if;
  if (select cash_cents from orders where id = v_order) <> 0 then
    raise exception 'Q3: cash_cents should be zero on an FSC-only purchase';
  end if;
  if fn_credit_balance(v_buyer) <> v_before - v_price then
    raise exception 'Q3: FSC was not burned on settlement';
  end if;
  if (select status from credit_holds where id = v_hold) = 'active' then
    raise exception 'Q3: hold still active after settlement';
  end if;
end $$;
select pg_temp.assert_invariants('Q3 credit->cash');

-- ---------------------------------------------------------------------------
-- Q4  buyer FSC -> seller credit. FSC changes hands, no cash moves.
-- ---------------------------------------------------------------------------
do $$
declare
  v_listing uuid; v_order uuid; v_seller uuid; v_buyer uuid;
  v_hold uuid; v_price int := 8000;
  v_buyer_before bigint; v_seller_before bigint; v_net bigint;
begin
  select v into v_seller from _ids where k = 'seller_us';
  select v into v_buyer  from _ids where k = 'seller_us';

  -- buyer and seller must differ; use buyer_b, funded by selling to buyer_a
  select v into v_buyer from _ids where k = 'buyer_b';

  -- fund buyer_b with FSC: buyer_b sells a card for cash, takes credit payout
  declare v_fund uuid; v_fund_order uuid;
  begin
    update users set country_code = 'SG' where id = v_buyer;
    v_fund := pg_temp.mk_listing(v_buyer, 20000, 'credit');
    v_fund_order := fn_purchase_card(
      v_fund, (select v from _ids where k = 'buyer_a'), 'smoke_q4_fund', 0, null);
  end;

  v_buyer_before  := fn_credit_balance(v_buyer);
  v_seller_before := fn_credit_balance(v_seller);

  v_listing := pg_temp.mk_listing(v_seller, v_price, 'credit');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_buyer::text, 'role', 'authenticated')::text, true);
  v_hold := fn_reserve_credit(v_listing, v_price);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  v_order := fn_purchase_card(v_listing, v_buyer, 'smoke_q4_ref', v_price, v_hold);
  select net_cents into v_net from orders where id = v_order;

  if fn_credit_balance(v_buyer) <> v_buyer_before - v_price then
    raise exception 'Q4: buyer FSC not burned correctly';
  end if;
  if fn_credit_balance(v_seller) <> v_seller_before + v_net then
    raise exception 'Q4: seller FSC not issued correctly (% vs %)',
      fn_credit_balance(v_seller), v_seller_before + v_net;
  end if;
end $$;
select pg_temp.assert_invariants('Q4 credit->credit');

-- ---------------------------------------------------------------------------
-- Q5  buyer pays BOTH -> seller cash. Partial settlement.
--     This is the checkout case track/market has to build, and the one
--     nothing has ever exercised.
-- ---------------------------------------------------------------------------
do $$
declare
  v_listing uuid; v_order uuid; v_seller uuid; v_buyer uuid;
  v_hold uuid; v_price int := 30000; v_credit bigint := 5000;
  v_before bigint;
begin
  select v into v_seller from _ids where k = 'seller_my';
  select v into v_buyer  from _ids where k = 'buyer_b';

  v_before := fn_credit_available(v_buyer);
  if v_before < v_credit then
    raise exception 'Q5: buyer has % FSC available, needs %', v_before, v_credit;
  end if;

  v_listing := pg_temp.mk_listing(v_seller, v_price, 'cash');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_buyer::text, 'role', 'authenticated')::text, true);
  v_hold := fn_reserve_credit(v_listing, v_credit);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  v_order := fn_purchase_card(v_listing, v_buyer, 'smoke_q5_ref', v_credit, v_hold);

  if (select credit_cents from orders where id = v_order) <> v_credit then
    raise exception 'Q5: credit_cents wrong';
  end if;
  if (select cash_cents from orders where id = v_order) <> v_price - v_credit then
    raise exception 'Q5: cash_cents should be price minus FSC applied (% vs %)',
      (select cash_cents from orders where id = v_order), v_price - v_credit;
  end if;
  if (select cash_cents + credit_cents from orders where id = v_order) <> v_price then
    raise exception 'Q5: split does not sum to price';
  end if;
end $$;
select pg_temp.assert_invariants('Q5 split->cash');

-- ---------------------------------------------------------------------------
-- Q6  hold expiry. now() is frozen inside this transaction, so the hold is
--     backdated at insert rather than waited out, then swept for real.
-- ---------------------------------------------------------------------------
do $$
declare
  v_listing uuid; v_buyer uuid; v_seller uuid; v_hold uuid;
  v_amt bigint := 3000; v_avail_before bigint; v_expired int;
begin
  select v into v_seller from _ids where k = 'seller_my';
  select v into v_buyer  from _ids where k = 'buyer_b';

  v_listing := pg_temp.mk_listing(v_seller, 15000, 'cash');
  v_avail_before := fn_credit_available(v_buyer);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_buyer::text, 'role', 'authenticated')::text, true);
  v_hold := fn_reserve_credit(v_listing, v_amt);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  if fn_credit_available(v_buyer) <> v_avail_before - v_amt then
    raise exception 'Q6: hold did not reduce available';
  end if;

  update credit_holds set expires_at = now() - interval '1 hour' where id = v_hold;

  v_expired := fn_expire_credit_holds();
  if v_expired < 1 then
    raise exception 'Q6: fn_expire_credit_holds returned %, expected >= 1', v_expired;
  end if;
  if (select status from credit_holds where id = v_hold) = 'active' then
    raise exception 'Q6: expired hold is still active';
  end if;
  if fn_credit_available(v_buyer) <> v_avail_before then
    raise exception 'Q6: expiry did not return the FSC to available (% vs %)',
      fn_credit_available(v_buyer), v_avail_before;
  end if;

  -- an expired hold must not be spendable
  begin
    perform fn_purchase_card(v_listing, v_buyer, 'smoke_q6_ref', v_amt, v_hold);
    raise exception 'Q6: SETTLED AGAINST AN EXPIRED HOLD — this must be refused';
  exception
    when others then
      if sqlerrm like '%SETTLED AGAINST AN EXPIRED HOLD%' then raise; end if;
      raise notice 'Q6 ok — expired hold refused (%)', sqlerrm;
  end;
end $$;
select pg_temp.assert_invariants('Q6 hold expiry');

-- ---------------------------------------------------------------------------
-- SOLVENCY + SWEEP CEILING
-- ---------------------------------------------------------------------------
do $$
declare
  v_currency bigint; v_sweepable bigint; v_admin uuid; r record;
begin
  select v into v_admin from _ids where k = 'admin';

  select coalesce(sum(amount_cents * direction), 0) into v_currency
  from ledger_entries where is_platform and asset = 'currency';

  -- fn_check_solvency, fn_platform_position and fn_record_sweep all call
  -- fn_require_admin() internally — they refuse postgres and service_role
  -- despite carrying a PUBLIC EXECUTE grant. Become an admin to read them.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  for r in select * from fn_check_solvency(v_currency) loop
    if not r.ok then
      raise exception 'SOLVENCY: variance % — %', r.variance_cents, r.detail;
    end if;
    raise notice 'SOLVENCY ok — liability % / unswept %',
      r.liability_cents, r.unswept_cents;
  end loop;

  select sweepable_cents into v_sweepable from fn_platform_position();
  raise notice 'POSITION: sweepable %', v_sweepable;

  -- the over-sweep trigger must refuse more than unswept commission
  begin
    perform fn_record_sweep(v_sweepable + 100000, 'smoke_oversweep', 'smoke');
    raise exception 'SWEEP GUARD FAILED — an over-sweep was accepted';
  exception
    when others then
      if sqlerrm like '%SWEEP GUARD FAILED%' then raise; end if;
      raise notice 'SWEEP GUARD ok — over-sweep refused (%)', sqlerrm;
  end;

  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- RESULTS
-- ---------------------------------------------------------------------------
-- Top-level reset: a set_config('role', ...) inside a plpgsql block does not
-- reliably unwind, and the temp tables belong to postgres.
reset role;
reset request.jwt.claims;

select * from _log;
select entry_type, asset, is_platform, count(*),
       sum(amount_cents * direction) as net
from ledger_entries
where settlement_ref like 'smoke_%'
   or txn_id in (select txn_id from orders where settlement_ref like 'smoke_%')
group by 1,2,3 order by 1,2,3;

rollback;
-- ============================================================================
-- If you reached here with no exception, every quadrant executed against live
-- SQL and the identity held after each one. Nothing was written.
-- ============================================================================
