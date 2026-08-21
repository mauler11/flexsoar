-- 019b_payout_routing.sql
--
-- RUN 019a FIRST. This file references enum values added there.
--
-- Payout method stops being a seller's choice and becomes a fact about where
-- they are. The reason is a hard constraint, not a policy preference: a Stripe
-- Malaysia platform can only pay out to Malaysian connected accounts, and is
-- not permitted to collect application fees on non-Malaysian ones. So a
-- Malaysian seller can be paid cash and a Japanese seller cannot, and no
-- amount of code changes that.
--
-- Consequences that fall out of removing the choice:
--   - credit_payout_premium_bps goes to 0. There is no election left to
--     reward, which deletes the inversion bug rather than fixing it. The old
--     fixed 500bps against a seller_fee_bps that fell to 300 at level 8 made
--     v_platform negative above level 5 and minted uncollateralised credit.
--   - fn_purchase_credit is revoked. FSC is earned, never bought. Nobody hands
--     the platform cash in advance, so there is no stored value and no
--     top-up charge to be disputed.
--   - the two-fulfilment cash gate is obsolete. It gated trust; payout now
--     keys off geography. The key is repurposed as the payout hold window.
--
-- This file does NOT rewrite fn_purchase_card_core, fn_list_card,
-- fn_submit_listing or fn_purchase_card_with_credit. Those come in 019c.
-- Everything here is safe to apply on its own and changes no existing
-- behaviour except the two config values and the items.custody default.
--
-- Safe to re-run.

begin;

-- 1. Which countries can receive cash --------------------------------------
-- A table rather than a hardcoded 'MY' so that adding a country later is an
-- INSERT, not a migration. This list is bounded by Stripe's supported payout
-- corridors for a Malaysian platform - do not add a country here until you
-- have confirmed Stripe will actually settle to it.

create table if not exists cash_payout_countries (
  country_code char(2)     primary key,
  note         text        not null,
  added_at     timestamptz not null default now()
);

comment on table cash_payout_countries is
  'Seller countries eligible for cash settlement. Everyone else is paid in '
  'FSC. Governed by Stripe payout corridors, not by business preference.';

insert into cash_payout_countries (country_code, note) values
  ('MY', 'Home corridor. Stripe Malaysia platform to Malaysian connected account.')
on conflict (country_code) do nothing;

alter table cash_payout_countries enable row level security;

drop policy if exists cash_payout_countries_read on cash_payout_countries;
create policy cash_payout_countries_read on cash_payout_countries
  for select using (true);

drop policy if exists cash_payout_countries_admin_write on cash_payout_countries;
create policy cash_payout_countries_admin_write on cash_payout_countries
  for all using (fn_is_admin()) with check (fn_is_admin());

grant select on cash_payout_countries to anon, authenticated;


-- 2. Routing function -------------------------------------------------------
-- NULL, blank or unknown country_code resolves to credit. That is the safe
-- direction: crediting a seller who should have had cash is a correctable
-- mistake, paying cash to a corridor Stripe will not settle is a stuck
-- transfer and a support ticket.

create or replace function fn_payout_method_for_user(p_user uuid)
returns payout_method
language sql
stable
security definer
set search_path = public
as $$
  select case
           when exists (
             select 1
             from users u
             join cash_payout_countries c
               on c.country_code = upper(btrim(u.country_code))
             where u.id = p_user
           )
           then 'cash'::payout_method
           else 'credit'::payout_method
         end;
$$;

comment on function fn_payout_method_for_user(uuid) is
  'Authoritative payout routing. Callers must never accept a payout_method '
  'from the client - derive it here. Unknown country resolves to credit.';

grant execute on function fn_payout_method_for_user(uuid) to authenticated;


-- 3. Config -----------------------------------------------------------------

update platform_config
   set num_value  = 0,
       note       = 'DEAD as of 019b. There is no payout election to reward, '
                    'so there is no premium. Do not raise this above 0: the '
                    'old fixed 500bps against a seller_fee_bps falling to 300 '
                    'at level 8 made platform margin negative above level 5 '
                    'and minted uncollateralised credit.',
       updated_at = now()
 where key = 'credit_payout_premium_bps';

update platform_config
   set note       = 'DEAD as of 019b. FSC is earned-only; there is no top-up. '
                    'fn_purchase_credit is revoked.',
       updated_at = now()
 where key = 'credit_purchase_min_cents';

update platform_config
   set note       = 'DEAD as of 019b. Payout is derived from seller country '
                    'via fn_payout_method_for_user, not earned through '
                    'fulfilments. Superseded by payout_hold_days.',
       updated_at = now()
 where key = 'cash_payout_min_fulfilments';

update platform_config
   set note       = 'Master switch for FSC settlement. False = every seller '
                    'must be cash-payable, which in practice means Malaysia '
                    'only. Leave true.',
       updated_at = now()
 where key = 'credit_payout_enabled';

update platform_config
   set note       = 'FLOOR, not the price. Real MY->US/JP shipping on a '
                    'sneaker is 4000-8000 cents. redemptions.handling_fee_cents '
                    'must be set from a live quote at request time; this value '
                    'is only the minimum the platform will ever charge.',
       updated_at = now()
 where key = 'redemption_handling_fee_cents';

insert into platform_config (key, num_value, bool_value, note) values
  ('payout_hold_days', 7, null,
   'Days a consignor cash payout is withheld after a sale before release. '
   'The only defence against a buyer chargeback landing after the money has '
   'left. Raise it, do not lower it.'),
  ('proof_required_on_first_sale', null, true,
   'Demand fresh proof of possession when an item''s card sells for the first '
   'time - the moment the consignor stops being the economic owner.'),
  ('proof_response_days', 7, null,
   'Days a consignor has to answer a routine proof-of-possession request. '
   'Redemption requests use a shorter window; someone is waiting on those.')
on conflict (key) do nothing;


-- 4. Custody default --------------------------------------------------------
-- Every launch item is consignor-held. The warehouse default would silently
-- mislabel the first submission.

alter table items alter column custody set default 'seller'::custody_model;


-- 5. Close the top-up -------------------------------------------------------
-- Revoked, not dropped. The body stays intact so re-enabling is a GRANT, and
-- so that 016's credit ledger constraints keep being exercised by tests.

revoke execute on function fn_purchase_credit(uuid, bigint, text) from anon;
revoke execute on function fn_purchase_credit(uuid, bigint, text) from authenticated;
revoke execute on function fn_purchase_credit(uuid, bigint, text) from public;

comment on function fn_purchase_credit(uuid, bigint, text) is
  'REVOKED as of 019b. Selling FSC for cash makes it prepaid stored value, '
  'creates a pool of customer funds held in advance, and produces top-up '
  'charges that are close to indefensible in a chargeback. FSC is earned-only: '
  'issued to a seller Stripe cannot pay out to, against a completed card '
  'transfer. Do not re-grant without understanding why it was closed.';

commit;
