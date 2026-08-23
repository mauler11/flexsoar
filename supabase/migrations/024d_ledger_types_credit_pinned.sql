-- ============================================================================
-- 024d_ledger_types_credit_pinned.sql
--
-- ENUM ADDITION ONLY. Own file: `ALTER TYPE ... ADD VALUE` cannot be used by a
-- statement in the same transaction that adds it. 024e uses these.
--
-- WHY THESE EXIST
-- ledger_entries carries a biconditional check, ledger_credit_closed_loop:
--   (asset = 'credit') = (entry_type in (credit_purchase, credit_sale_gross,
--                                        credit_sale_net, credit_sale_fee))
-- Read in reverse, it pins every entry type to exactly one asset class. That
-- is a good rule and 024e keeps it - but it means 023c's reversal types and
-- 024b's trade fee, which were written as if one type could serve both assets,
-- cannot.
--
-- Consequences that were already latent before this file:
--   * fn_confirm_sale_cancellation maps credit_sale_gross ->
--     sale_reversal_gross with asset 'credit'. The constraint rejects it, so
--     cancelling an FSC-PAID sale fails outright. Smoke V3 passed only because
--     it cancelled a cash sale. That is the vault unwind - the thing the whole
--     custody model rests on - broken for exactly the buyers who pay in FSC.
--   * fn_accept_trade_offer books the flat fee as trade_fee on asset 'credit'.
--     Same rejection; no trade with a fee could ever settle.
--
-- THE CHOICE MADE: pin every type to one asset, mirroring the existing
-- sale_gross / credit_sale_gross split from 011, rather than loosening the
-- constraint to let some types float across assets. A type that spans both
-- would be the only one in the schema that does not declare its asset, and
-- summing it would silently add dollars to FSC. The separation of currency
-- from credit is what every other invariant here depends on.
--
--   credit_sale_reversal_gross   returns FSC to a buyer on a cancelled sale
--   credit_sale_reversal_net     removes an FSC payout from a seller
--   credit_sale_reversal_fee     cancels commission taken in FSC
--   trade_credit_fee             the flat trade fee, paid in FSC
--
-- `trade_fee` stays currency-pinned and unused for now - it is what a cash
-- boot will book against when that arrives.
--
-- RUN IN: Supabase SQL editor, "Run without RLS". On its own, before 024e.
-- ============================================================================

alter type ledger_entry_type add value if not exists 'credit_sale_reversal_gross';
alter type ledger_entry_type add value if not exists 'credit_sale_reversal_net';
alter type ledger_entry_type add value if not exists 'credit_sale_reversal_fee';
alter type ledger_entry_type add value if not exists 'trade_credit_fee';

-- ---------------------------------------------------------------------------
-- Verify before 024e:
--   select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
--   where t.typname = 'ledger_entry_type' order by e.enumsortorder;
-- ---------------------------------------------------------------------------
