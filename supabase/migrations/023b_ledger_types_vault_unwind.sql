-- ============================================================================
-- 023b_ledger_types_vault_unwind.sql
--
-- ENUM ADDITION ONLY. Separate file because `ALTER TYPE ... ADD VALUE` cannot
-- be used by a statement in the same transaction that adds it. 023c uses these
-- values; this must be committed first.
--
-- These four support the vault-default unwind (custody model, 2026-08-22):
-- when a consignor fails to ship the physical shoe within 48h of first sale,
-- the sale is cancelled, the buyer is refunded in kind, the card is burned,
-- and the consignor is banned.
--
-- WHY NEW TYPES RATHER THAN FLIPPING DIRECTION ON THE EXISTING ONES:
-- reversing a sale by writing sale_gross with the opposite direction would
-- make `sum(amount_cents) where entry_type = 'sale_gross'` stop meaning sales
-- volume. That is exactly the trap found on 2026-08-22, where sale_fee doubles
-- as the platform's pool movement and totals 36800 against real commission of
-- 12240. One entry type, one meaning.
--
-- The ledger stays append-only: nothing is deleted or updated. A cancellation
-- is a new transaction that offsets the original, and both remain visible.
--
--   sale_reversal_gross  returns the buyer's payment (currency and/or credit)
--   sale_reversal_fee    cancels the platform's commission on that sale
--   sale_reversal_net    removes the consignor's pending payout, which is
--                        still inside the 7-day payout hold and so has not
--                        left the platform
--   vault_default_burn   destroys the card. Distinct from redemption_burn:
--                        a redemption burn means the holder got their shoe,
--                        this means the shoe never arrived. Conflating them
--                        would corrupt redemption reporting and hide the
--                        default rate, which is the one number that tells you
--                        whether the custody model is working.
--
-- NOTE: orders.status is `text`, not an enum, so the 'cancellation_pending'
-- and 'cancelled' states 023c introduces need no type change.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- Run this file COMPLETELY on its own, before 023c.
-- ============================================================================

alter type ledger_entry_type add value if not exists 'sale_reversal_gross';
alter type ledger_entry_type add value if not exists 'sale_reversal_fee';
alter type ledger_entry_type add value if not exists 'sale_reversal_net';
alter type ledger_entry_type add value if not exists 'vault_default_burn';

-- ---------------------------------------------------------------------------
-- Verify before moving on to 023c:
--
--   select enumlabel
--   from pg_enum e join pg_type t on t.oid = e.enumtypid
--   where t.typname = 'ledger_entry_type'
--     and enumlabel like '%reversal%' or enumlabel = 'vault_default_burn'
--   order by e.enumsortorder;
--
-- Expected: sale_reversal_gross, sale_reversal_fee, sale_reversal_net,
--           vault_default_burn
-- ---------------------------------------------------------------------------
