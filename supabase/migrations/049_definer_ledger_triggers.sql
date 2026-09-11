-- ============================================================================
-- 049_definer_ledger_triggers.sql
--
-- WHY REDEEM FAILED with "currency entries do not net to zero (got -1500)"
-- while purchases always balanced:
--
-- The ledger balance triggers (trg_ledger_balanced and siblings) are plain
-- SQL/PLpgSQL functions: they evaluate with the CALLER's RLS slice, not the
-- table owner's. Their check query (SUM over the txn's rows) is therefore
-- filtered by ledger_own_read (account_id = me) — and the platform offset
-- leg (account_id NULL) is invisible to it. Sum: buyer -1500 only. Raise.
--
-- Purchases never tripped this because they run through the Stripe webhook
-- as service_role, which bypasses RLS and sees every leg. Redeem is the
-- FIRST user-session flow that books a NULL-account currency leg, so it is
-- the first to meet the wall. Any future session flow writing platform legs
-- would hit the same wall — hence all three triggers, not just currency.
--
-- FIX: integrity-check triggers must see the whole transaction. Marking
-- them SECURITY DEFINER (owner postgres) lifts only their own check
-- queries past RLS; they write nothing and change no policy. User reads
-- through ledger_own_read are untouched — platform earnings rows stay
-- hidden from SELECTs (020 depends on that).
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER FUNCTION trg_ledger_balanced() SECURITY DEFINER;
ALTER FUNCTION trg_ledger_credit_balanced() SECURITY DEFINER;
ALTER FUNCTION trg_ledger_card_balanced() SECURITY DEFINER;

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('trg_ledger_balanced', 'trg_ledger_credit_balanced', 'trg_ledger_card_balanced')
    AND p.prosecdef IS NOT TRUE;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '049: not definer: %', v_missing;
  END IF;

  RAISE NOTICE '049 ok: ledger balance triggers evaluate as owner';
END $$;
