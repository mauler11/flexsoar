-- ============================================================================
-- 030_fair_price_approval.sql
--
-- Add fair_price_cents to fn_approve_submission
-- RUN IN: Supabase SQL editor, "Run without RLS". Single pass.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Drop old overloads of fn_approve_submission, then create new 3-param version
--    (CREATE OR REPLACE with different param count creates overloads, not replacement)
-- ---------------------------------------------------------------------------

drop function if exists fn_approve_submission(uuid, integer);
drop function if exists fn_approve_submission(uuid, integer, integer);

create function fn_approve_submission(
  p_item_id uuid, p_price_cents integer default null, p_fair_price_cents integer default null)
returns uuid language plpgsql security definer as $$
declare
  v_admin   uuid;
  v_item    items%rowtype;
  v_card    uuid;
  v_price   integer;
  v_fair    integer;
  v_listing uuid;
begin
  v_admin := fn_require_admin();

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;
  if v_item.status <> 'pending_review' then
    raise exception 'item % is %, expected pending_review', p_item_id, v_item.status;
  end if;

  -- FlexSoar has reviewed the submission. For a seller-held item this
  -- attests the review, not physical authentication — grade_source keeps
  -- that distinction honest.
  update items set
    status           = 'in_custody',
    authenticated_by = v_admin,
    authenticated_at = now()
  where id = p_item_id;

  v_card  := fn_mint_card(p_item_id, v_item.consignor_id);
  v_price := coalesce(p_price_cents, v_item.asking_price_cents);
  v_fair  := p_fair_price_cents;

  insert into listings (card_id, seller_id, price_cents, fair_price_cents, status,
                        early_access_level, public_at, oracle_value_cents,
                        payout_method)
  values (v_card, v_item.consignor_id, v_price, v_fair, 'public',
          1, now(), fn_card_value_cents(v_card), v_item.submitted_payout)
  returning id into v_listing;

  update cards set status = 'locked' where id = v_card;
  return v_listing;
end $$;

grant execute on function fn_approve_submission(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Update fn_list_card to accept fair_price_cents (for direct listings)
-- ---------------------------------------------------------------------------

do $$
declare v_sig text;
begin
  select pg_get_function_identity_arguments(oid) into v_sig
  from pg_proc
  where proname = 'fn_list_card'
    and pronamespace = 'public'::regnamespace;
  
  if v_sig not like '%fair_price_cents%' then
    raise notice 'fn_list_card signature: % (needs fair_price_cents)', v_sig;
  else
    raise notice 'fn_list_card already has fair_price_cents';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_sig text;
begin
  select pg_get_function_identity_arguments(oid) into v_sig
  from pg_proc
  where proname = 'fn_approve_submission'
    and pronamespace = 'public'::regnamespace;
  
  if v_sig not like '%fair_price_cents%' then
    raise exception '030: fn_approve_submission missing fair_price_cents parameter. Got: %', v_sig;
  end if;
  
  if not exists (select 1 from information_schema.columns
                 where table_name = 'listings'
                   and column_name = 'fair_price_cents'
                   and data_type = 'integer') then
    raise exception '030: fair_price_cents column missing from listings';
  end if;

  raise notice '030 ok: fn_approve_submission updated with fair_price_cents';
end $$;

commit;

-- ============================================================================
-- AFTER RUNNING:
--
--   1. Update approveSubmissionAction to accept fair_price_cents
--   2. Update admin submission page to include fair price input
--   3. Update db-writes.ts approveSubmission to pass fair_price_cents
-- ============================================================================