-- 017_purchase_card_idempotency.sql
--
-- Makes card purchase idempotent on the Stripe settlement reference.
--
-- fn_purchase_credit already returns early on a redelivered webhook.
-- fn_purchase_card had no such guard: a redelivery re-entered the function,
-- blocked on the `for update` row lock, then raised because the listing was
-- no longer purchasable. Correct outcome, wrong mechanism — the raise returns
-- a non-2xx to Stripe, which retries, which raises again.
--
-- The existing function is renamed rather than rewritten. Its body is left
-- byte-for-byte intact; a thin wrapper takes the original name, so
-- lib/api/contract.ts needs no change.
--
-- Two layers, deliberately:
--   1. A lookup on orders.settlement_ref, which handles sequential redelivery.
--   2. A unique index, which handles concurrent redelivery — the second
--      writer fails at insert and the wrapper catches it and returns the
--      order the first writer created.
--
-- Verified before writing: select settlement_ref, count(*) from orders
-- ... having count(*) > 1 returns zero rows, so the index will build.

-- ---------------------------------------------------------------------------
-- 1. Uniqueness on the settlement reference
-- ---------------------------------------------------------------------------

create unique index if not exists orders_settlement_ref_uidx
  on orders (settlement_ref)
  where settlement_ref is not null;

-- ---------------------------------------------------------------------------
-- 2. Rename the existing implementation
-- ---------------------------------------------------------------------------
-- Grants follow the function's identity through a rename, so whatever could
-- execute fn_purchase_card can still execute the core.

alter function fn_purchase_card(uuid, uuid, text)
  rename to fn_purchase_card_core;

comment on function fn_purchase_card_core(uuid, uuid, text) is
  'Card purchase implementation. Not idempotent — call fn_purchase_card '
  'instead, which guards on settlement_ref.';

-- ---------------------------------------------------------------------------
-- 3. Idempotent wrapper at the original name
-- ---------------------------------------------------------------------------

create or replace function fn_purchase_card(
  p_listing_id     uuid,
  p_buyer_id       uuid,
  p_settlement_ref text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  -- Sequential redelivery: the order is already committed and visible.
  if p_settlement_ref is not null then
    select id into v_existing
      from orders
     where settlement_ref = p_settlement_ref;

    if found then
      return v_existing;
    end if;
  end if;

  return fn_purchase_card_core(p_listing_id, p_buyer_id, p_settlement_ref);

exception
  -- Concurrent redelivery: both callers passed the lookup, the loser's insert
  -- hit orders_settlement_ref_uidx. The winner has committed by the time the
  -- violation surfaces, so a fresh read finds it.
  when unique_violation then
    select id into v_existing
      from orders
     where settlement_ref = p_settlement_ref;

    if v_existing is null then
      raise;  -- some other unique constraint; not ours to swallow
    end if;

    return v_existing;
end;
$$;

comment on function fn_purchase_card(uuid, uuid, text) is
  'Purchase a card, idempotent on p_settlement_ref. A redelivered Stripe '
  'webhook returns the original order id instead of raising, so the handler '
  'can answer 200 and stop the retry loop.';

-- ---------------------------------------------------------------------------
-- 4. Grants on the wrapper
-- ---------------------------------------------------------------------------
-- Adjust to match the grants the original carried. Confirm with:
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name = 'fn_purchase_card_core';

revoke execute on function fn_purchase_card(uuid, uuid, text) from public, anon;
grant  execute on function fn_purchase_card(uuid, uuid, text) to service_role;
