-- 016_credit_ledger_fix.sql
--
-- Three fixes to the FSC credit ledger.
--
-- 1. ledger_entries_check has no branch for asset = 'credit'. It permits only
--    currency and card rows, so every insert fn_purchase_credit and
--    fn_purchase_card_with_credit have ever attempted has failed. Verified:
--    select asset, count(*) from ledger_entries returns card and currency only.
--
-- 2. Closed-loop enforcement. FSC is store credit that never converts back to
--    money. Today that is true only because nobody wrote a payout path. This
--    makes it structural: credit rows may carry only credit entry types, and
--    credit entry types may only be credit rows. A future attempt to settle
--    credit as currency hits a constraint instead of a code review.
--
-- 3. Settlement idempotency. Stripe redelivers webhooks, sometimes
--    concurrently. fn_purchase_credit guards with an EXISTS check, which is
--    check-then-insert and races. fn_purchase_card has no guard at all. Unique
--    indexes make the second writer fail at commit rather than double-credit a
--    balance or double-pay a seller.

-- ---------------------------------------------------------------------------
-- 1. Credit branch
-- ---------------------------------------------------------------------------
-- A credit row carries an amount and no card, exactly like a currency row.

alter table ledger_entries drop constraint ledger_entries_check;

alter table ledger_entries add constraint ledger_entries_check check (
     (asset = 'currency' and amount_cents is not null and card_id is null)
  or (asset = 'card'     and card_id     is not null and amount_cents is null)
  or (asset = 'credit'   and amount_cents is not null and card_id is null)
);

-- ---------------------------------------------------------------------------
-- 2. Closed loop
-- ---------------------------------------------------------------------------
-- Biconditional, deliberately. Left to right: a credit row cannot carry
-- sale_net or any other currency entry type. Right to left: a credit entry
-- type cannot be written as currency — which is what paying a credit balance
-- out as money would look like.
--
-- Existing rows satisfy this: no row currently has asset = 'credit', and no
-- existing row carries a credit_* entry type.

alter table ledger_entries add constraint ledger_credit_closed_loop check (
  (asset = 'credit') = (entry_type in (
    'credit_purchase',
    'credit_sale_gross',
    'credit_sale_net',
    'credit_sale_fee'
  ))
);

comment on constraint ledger_credit_closed_loop on ledger_entries is
  'FSC never leaves the platform. Credit rows carry only credit entry types, '
  'and credit entry types are never settled as currency. Removing this '
  'constraint is a compliance decision, not a refactor.';

-- ---------------------------------------------------------------------------
-- 3. Settlement idempotency
-- ---------------------------------------------------------------------------
-- One top-up per Stripe settlement reference. Scoped to the non-platform leg
-- because each top-up writes two rows (user side and platform side) sharing
-- one settlement_ref.

create unique index if not exists ledger_credit_purchase_settlement_uidx
  on ledger_entries (settlement_ref)
  where entry_type = 'credit_purchase'
    and is_platform = false
    and settlement_ref is not null;

-- One card sale per settlement reference. A sale writes sale_gross, sale_net
-- and sale_fee under one ref, so the buyer-debit leg is the unique one.
-- Existing seed data has exactly one sale_gross per seed_pi_* ref.

create unique index if not exists ledger_sale_gross_settlement_uidx
  on ledger_entries (settlement_ref)
  where entry_type = 'sale_gross'
    and settlement_ref is not null;
