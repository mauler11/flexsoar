-- ============================================================================
-- 044_sku_requests.sql
--
-- Product requests: when a seller's shoe isn't in the catalog, they request
-- it (brand/model/colorway/size/notes/photos) instead of free-creating a
-- model inline. Requests sit pending until an admin approves (creates the
-- model + size variant via the existing admin-gated functions) or rejects.
--
-- Writes go through RLS, not new SECURITY DEFINER functions: sellers insert
-- and read only their own rows; admins (fn_is_admin) see and resolve all.
--
-- RUN IN: Supabase SQL editor, "Run without RLS".
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sku_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES users(id),
  brand         text NOT NULL,
  model         text NOT NULL,
  colorway      text NOT NULL DEFAULT '',
  size_us       numeric(4,1),
  notes         text NOT NULL DEFAULT '',
  photos        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sku_requests_requester_idx ON sku_requests (requester_id);
CREATE INDEX IF NOT EXISTS sku_requests_status_idx ON sku_requests (status) WHERE status = 'pending';

ALTER TABLE sku_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sku_requests_own_insert ON sku_requests;
CREATE POLICY sku_requests_own_insert ON sku_requests
  FOR INSERT WITH CHECK (requester_id = fn_current_user_id());

DROP POLICY IF EXISTS sku_requests_own_read ON sku_requests;
CREATE POLICY sku_requests_own_read ON sku_requests
  FOR SELECT USING (requester_id = fn_current_user_id());

DROP POLICY IF EXISTS sku_requests_admin_all ON sku_requests;
CREATE POLICY sku_requests_admin_all ON sku_requests
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

REVOKE ALL ON sku_requests FROM anon;
GRANT SELECT, INSERT, UPDATE ON sku_requests TO authenticated;
GRANT ALL ON sku_requests TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_policies text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'sku_requests') THEN
    RAISE EXCEPTION '044: sku_requests table missing';
  END IF;

  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'sku_requests';
  IF v_policies IS NULL
     OR v_policies NOT LIKE '%sku_requests_own_insert%'
     OR v_policies NOT LIKE '%sku_requests_own_read%'
     OR v_policies NOT LIKE '%sku_requests_admin_all%' THEN
    RAISE EXCEPTION '044: sku_requests RLS policies wrong. Got: %', v_policies;
  END IF;

  RAISE NOTICE '044 ok: sku_requests + RLS (%)', v_policies;
END $$;
