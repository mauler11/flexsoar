-- 019a_ledger_entry_types.sql
--
-- RUN THIS FILE ON ITS OWN, BEFORE 019b.
--
-- Postgres will not let a statement use an enum value that was added by an
-- earlier statement in the same transaction. Every new ledger_entry_type
-- therefore has to be committed before any function body references it.
-- Splitting it into its own file is the only reliable way to guarantee that
-- in the Supabase editor.
--
-- Nothing here changes behaviour. It only widens the enum.
--
-- Safe to re-run.

alter type ledger_entry_type add value if not exists 'platform_credit_settle';
alter type ledger_entry_type add value if not exists 'trade_fee';
alter type ledger_entry_type add value if not exists 'payout_hold';
alter type ledger_entry_type add value if not exists 'payout_release';

comment on type ledger_entry_type is
  'Ledger entry classification.

   platform_credit_settle - platform burns FSC it earned as commission on an
     FSC-settled sale and draws the matching cash from the pool. Keeps
     commission income currency-agnostic: the fee is taken in whatever the
     seller was paid in, then converted to cash against the pool.

   trade_fee - platform commission on a card-for-card trade, charged to the
     side receiving the higher-valued card. Reserved for migration 021.

   payout_hold / payout_release - a consignor cash payout withheld for the
     dispute window after a sale, then released. Defence against a buyer
     chargeback landing after the money has already left.

   DEPRECATED, do not use in new code:
     credit_purchase - the FSC top-up path. FSC is earned-only as of migration
       019b; it is never sold for cash. Postgres cannot drop an enum value, so
       this label survives as a tombstone. fn_purchase_credit is revoked.';
