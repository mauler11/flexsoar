-- ============================================================================
-- 031_vaulted_listing_fix.sql
--
-- When listing a vaulted item (custody = 'warehouse'), skip early_access and
-- card lock. The listing goes straight to 'public' and card stays 'active'.
-- Also add fair_price_cents parameter.
--
-- RUN IN: Supabase SQL editor, "Run without RLS". Single pass.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Update fn_list_card to handle vaulted items + fair_price_cents
-- ---------------------------------------------------------------------------

drop function if exists fn_list_card(uuid, uuid, integer);
drop function if exists fn_list_card(uuid, uuid, integer, payout_method);
drop function if exists fn_list_card(uuid, uuid, integer, payout_method, integer);

create function fn_list_card(
  p_card_id uuid,
  p_seller_id uuid,
  p_price_cents integer,
  p_payout_method payout_method default 'credit',
  p_fair_price_cents integer default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card    cards%rowtype;
  v_item    items%rowtype;
  v_minutes smallint;
  v_level   smallint;
  v_oracle  integer;
  v_listing uuid;
  v_is_vaulted boolean;
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

  -- Check if item is vaulted (in warehouse custody)
  select * into v_item from items where id = v_card.item_id;
  v_is_vaulted := (v_item.custody = 'warehouse');

  select u.level, l.early_access_minutes into v_level, v_minutes
  from users u join levels l on l.level = u.level where u.id = p_seller_id;

  v_oracle := fn_card_value_cents(p_card_id);

  insert into listings (card_id, seller_id, price_cents, fair_price_cents, status,
                        early_access_level, public_at, oracle_value_cents,
                        payout_method)
  values (p_card_id, p_seller_id, p_price_cents, p_fair_price_cents,
          case when v_is_vaulted then 'public' else 'early_access' end,
          case when v_is_vaulted then 0 else 4 end,
          case when v_is_vaulted then now() else now() + make_interval(mins => coalesce(v_minutes,0)) end,
          v_oracle,
          p_payout_method)
  returning id into v_listing;

  -- Only lock the card if it's not vaulted
  if not v_is_vaulted then
    update cards set status = 'locked' where id = p_card_id;
  end if;

  return v_listing;
end $$;

grant execute on function fn_list_card(uuid, uuid, integer, payout_method, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_sig text;
begin
  select pg_get_function_identity_arguments(oid) into v_sig
  from pg_proc
  where proname = 'fn_list_card'
    and pronamespace = 'public'::regnamespace;
  
  if v_sig not like '%fair_price_cents%' then
    raise exception '031: fn_list_card missing fair_price_cents parameter. Got: %', v_sig;
  end if;

  raise notice '031 ok: fn_list_card handles vaulted items + fair_price_cents';
end $$;

commit;

-- ============================================================================
-- AFTER RUNNING:
--   1. Admin (wizzy) listing vaulted items: goes straight to public, card stays active
--   2. Regular sellers: early_access + locked card (unchanged behavior)
-- ============================================================================