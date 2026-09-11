-- ============================================================================
-- 052_notifications_realtime.sql
--
-- Live bell: publish the notifications table on supabase_realtime so the
-- header bell refreshes the moment a row lands — no page reload. Delivery
-- still honors RLS (notifications_own_read): each session only receives its
-- own rows, so the client subscribes with no filter and the database does
-- the scoping.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public'
                   AND tablename = 'notifications') THEN
    RAISE EXCEPTION '052: notifications not in supabase_realtime publication';
  END IF;

  RAISE NOTICE '052 ok: notifications replicating';
END $$;
