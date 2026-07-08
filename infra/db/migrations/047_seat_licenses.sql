-- 047_seat_licenses.sql
-- Workstream 2 (platform tier): seat/license model + enforcement.
--
-- Two pieces:
--   plan_entitlements   Global reference table mapping each plan to its default
--                       seat allowance (and a display label). No tenant_id → no
--                       RLS; it's shared reference data every tenant reads.
--   tenants.seat_limit  Per-tenant override (nullable). NULL → fall back to the
--                       plan default. The provider "adds seats" by raising this.
--
-- Seat usage is simply the count of non-deleted users in a tenant. Enforcement
-- lives in the app (api-gateway POST /users + /invite): a create is rejected
-- when used >= effective limit.

BEGIN;

CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan        TEXT PRIMARY KEY,
  seat_limit  INTEGER NOT NULL CHECK (seat_limit > 0),
  label       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plan_entitlements (plan, seat_limit, label) VALUES
  ('starter',      5,   'Starter'),
  ('growth',       25,  'Growth'),
  ('enterprise',   100, 'Enterprise')
ON CONFLICT (plan) DO NOTHING;

-- Per-tenant seat override; NULL means "use the plan default".
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS seat_limit INTEGER
  CHECK (seat_limit IS NULL OR seat_limit > 0);

-- plan_entitlements is global reference data — grant read to the RLS-subject
-- roles + the provider console. Guarded so a plain (non-RLS) dev DB without the
-- split roles still applies cleanly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON plan_entitlements TO nexcrm_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_service') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON plan_entitlements TO nexcrm_service';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_platform') THEN
    EXECUTE 'GRANT SELECT ON plan_entitlements TO nexcrm_platform';
  END IF;
END $$;

COMMIT;
