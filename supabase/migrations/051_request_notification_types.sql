-- ============================================================================
-- 049_request_notification_types.sql
--
-- 028's notifications.type CHECK constraint allows only the original four
-- types, so request_approved / request_rejected inserts (admin review queue)
-- fail at the database — and the review action swallowed the rpc error, so
-- approvals looked successful with no bell ever arriving. Both halves fixed:
-- the constraint here, the silent swallow in app code alongside.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'submission_approved', 'card_sold', 'card_redeemed', 'payout_sent',
    'request_approved', 'request_rejected'
  ));

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conname = 'notifications_type_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '049: notifications_type_check missing';
  END IF;
  IF v_def NOT LIKE '%request_approved%' OR v_def NOT LIKE '%request_rejected%' THEN
    RAISE EXCEPTION '049: constraint lacks request types: %', v_def;
  END IF;

  RAISE NOTICE '049 ok: notification types extended';
END $$;
