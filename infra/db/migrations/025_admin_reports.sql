-- ── Admin Reports ────────────────────────────────────────────────────────────
-- 1. Add category column to reports table for admin-only reports
-- 2. Create feature_usage_log table for tracking per-user/per-role feature usage

-- Category: 'standard' = normal tenant reports, 'admin' = admin/super_admin only
ALTER TABLE reports ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'standard'
  CHECK (category IN ('standard', 'admin'));

-- Track feature usage per user for admin reporting
CREATE TABLE IF NOT EXISTS feature_usage_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT 'use',
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_usage_tenant
  ON feature_usage_log (tenant_id, feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_usage_user
  ON feature_usage_log (user_id, feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_usage_created
  ON feature_usage_log (created_at DESC);
