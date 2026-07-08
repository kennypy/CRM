-- 048_seat_requests.sql
-- Workstream 2: self-serve seat expansion for workspace admins.
--
-- An admin who needs more seats than their plan allows can:
--   1. self_approve — accept the extra monthly cost; seats are added at once.
--   2. finance      — route to their finance director via a tokened approval
--                     link; on approval the seats are added.
--   3. owner        — request the seats from the platform owner (provider),
--                     who approves/declines in the provider console.
--
-- Cost is driven by plan_entitlements.price_per_seat_cents (per seat / month).

BEGIN;

ALTER TABLE plan_entitlements
  ADD COLUMN IF NOT EXISTS price_per_seat_cents INTEGER NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

UPDATE plan_entitlements SET price_per_seat_cents = 1500 WHERE plan = 'starter';
UPDATE plan_entitlements SET price_per_seat_cents = 1200 WHERE plan = 'growth';
UPDATE plan_entitlements SET price_per_seat_cents = 1000 WHERE plan = 'enterprise';

CREATE TABLE IF NOT EXISTS seat_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by      UUID,
  requested_by_name TEXT,
  seats             INTEGER NOT NULL CHECK (seats > 0),
  unit_price_cents  INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'USD',
  decision          TEXT NOT NULL CHECK (decision IN ('self_approve', 'finance', 'owner')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  finance_email     TEXT,
  note              TEXT,
  token_hash        TEXT,               -- set for the finance channel (tokened link)
  resolved_by       TEXT,               -- 'finance' | 'owner' | a user id
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seat_requests_tenant  ON seat_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_seat_requests_status  ON seat_requests(status);
CREATE INDEX IF NOT EXISTS idx_seat_requests_token   ON seat_requests(token_hash) WHERE token_hash IS NOT NULL;

-- RLS: a workspace admin (nexcrm_app) sees/creates only its own tenant's
-- requests. The auth service (nexcrm_service, BYPASSRLS) handles the tokened
-- finance approval + the provider console cross-tenant view.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_app') THEN
    EXECUTE 'ALTER TABLE seat_requests ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON seat_requests';
    EXECUTE 'CREATE POLICY tenant_isolation ON seat_requests FOR ALL TO nexcrm_app '
      || 'USING (tenant_id::text = current_setting(''app.current_tenant'', true)) '
      || 'WITH CHECK (tenant_id::text = current_setting(''app.current_tenant'', true))';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_platform') THEN
    EXECUTE 'DROP POLICY IF EXISTS platform_read_all ON seat_requests';
    EXECUTE 'CREATE POLICY platform_read_all ON seat_requests FOR SELECT TO nexcrm_platform USING (true)';
  END IF;
END $$;

COMMIT;
