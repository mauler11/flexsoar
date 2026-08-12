-- ============================================================
-- FlexSoar — 012_art_url_and_payout_guard.sql
-- Run in the Supabase SQL editor, "Run without RLS".
-- ============================================================
-- Two corrections.
--
-- 1. skus.art_url was added by hand in the SQL editor and never written
--    to a migration, so supabase/migrations/ no longer reproduces the
--    live schema. This restates it idempotently. Both track/admin and
--    track/design filed it.
--
-- 2. 011 gave listings a payout_method, but fn_purchase_card — the
--    Stripe path — never checked it. A seller who elected credit-only
--    could be paid cash they never asked for. The credit path already
--    refuses cash listings; this makes the cash path symmetrical.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Card art
-- ------------------------------------------------------------

alter table skus add column if not exists art_url text;

alter table skus drop constraint if exists skus_art_url_https;
alter table skus add constraint skus_art_url_https
  check (art_url is null or art_url ~ '^https://');

-- ------------------------------------------------------------
-- 2. fn_purchase_card — as defined in 002, plus the payout guard.
--    Everything else is byte-for-byte the original.
-- ------------------------------------------------------------

create or replace function fn_purchase_card(
  p_listing_id uuid, p_buyer_id uuid, p_settlement_ref text)
returns uuid language plpgsql security definer as $$
declare
  v_l          listings%rowtype;
  v_card       cards%rowtype;
  v_buyer_lvl  smallint;
  v_fee_bps    smallint;
  v_fee        integer;
  v_net        integer;
  v_txn        uuid := gen_random_uuid();
  v_order      uuid;
begin
  select * into v_l from listings where id = p_listing_id for update;
  if not found then raise exception 'listing % not found', p_listing_id; end if;
  if v_l.status not in ('early_access','public') then
    raise exception 'listing % is %', p_listing_id, v_l.status;
  end if;
  if v_l.seller_id = p_buyer_id then
    raise exception 'cannot buy your own listing';
  end if;

  -- NEW: the seller elected credit; cash settlement would pay them in an
  -- instrument they did not choose.
  if v_l.payout_method = 'credit' then
    raise exception 'listing % settles in credit and cannot be bought with cash',
      p_listing_id;
  end if;

  select * into v_card from cards where id = v_l.card_id for update;

  select level into v_buyer_lvl from users where id = p_buyer_id;
  if now() < v_l.public_at and coalesce(v_buyer_lvl,1) < v_l.early_access_level then
    raise exception 'listing % is in early access until %', p_listing_id, v_l.public_at;
  end if;

  select l.seller_fee_bps into v_fee_bps
  from users u join levels l on l.level = u.level where u.id = v_l.seller_id;

  v_fee := floor(v_l.price_cents * v_fee_bps / 10000.0);
  v_net := v_l.price_cents - v_fee;

  insert into orders (listing_id, card_id, buyer_id, seller_id, gross_cents,
                      fee_bps, fee_cents, net_cents, settlement_ref, status, txn_id)
  values (p_listing_id, v_l.card_id, p_buyer_id, v_l.seller_id, v_l.price_cents,
          v_fee_bps, v_fee, v_net, p_settlement_ref, 'settled', v_txn)
  returning id into v_order;

  insert into ledger_entries (txn_id, entry_type, asset, account_id, is_platform,
                              amount_cents, direction, settlement_ref) values
    (v_txn,'sale_gross','currency', p_buyer_id,   false, v_l.price_cents, -1, p_settlement_ref),
    (v_txn,'sale_net',  'currency', v_l.seller_id,false, v_net,            1, p_settlement_ref),
    (v_txn,'sale_fee',  'currency', null,         true,  v_fee,            1, p_settlement_ref);

  insert into ledger_entries (txn_id, entry_type, asset, account_id, card_id, direction) values
    (v_txn,'card_transfer','card', v_l.seller_id, v_l.card_id, -1),
    (v_txn,'card_transfer','card', p_buyer_id,    v_l.card_id,  1);

  update cards set owner_id = p_buyer_id, status = 'active' where id = v_l.card_id;

  update card_provenance
     set released_at = now(), price_cents = v_l.price_cents
   where card_id = v_l.card_id and owner_id = v_l.seller_id and released_at is null;

  insert into card_provenance (card_id, owner_id, owner_level, acquired_at, price_cents)
  values (v_l.card_id, p_buyer_id, coalesce(v_buyer_lvl,1), now(), v_l.price_cents);

  update listings set status = 'sold', sold_at = now() where id = p_listing_id;

  perform fn_award_xp(p_buyer_id,   'purchase', greatest(10, v_l.price_cents / 1000), v_order);
  perform fn_award_xp(v_l.seller_id,'sale',     greatest(10, v_l.price_cents / 1000), v_order);

  return v_order;
end $$;

-- 004 revoked this from client roles and it stays that way: the Stripe
-- webhook has no session, so it runs service-role.
revoke execute on function fn_purchase_card(uuid, uuid, text)
  from public, anon, authenticated;
