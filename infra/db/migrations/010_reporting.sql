-- ── Reporting System ─────────────────────────────────────────────────────────
-- Reusable dataset specifications (versioned query models)
CREATE TABLE IF NOT EXISTS report_datasets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  description  TEXT,
  version      INT  NOT NULL DEFAULT 1,
  spec         JSONB NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS report_datasets_tenant_idx ON report_datasets(tenant_id, updated_at DESC);

-- Saved reports (dataset + viz/display config)
CREATE TABLE IF NOT EXISTS reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES users(id),
  dataset_id  UUID REFERENCES report_datasets(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  spec        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reports_tenant_idx ON reports(tenant_id, updated_at DESC);

-- Historical snapshots for comparison
CREATE TABLE IF NOT EXISTS report_snapshots (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  taken_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INT,
  data      JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS report_snapshots_report_idx ON report_snapshots(report_id, taken_at DESC);

-- Subscriptions (unlimited per user per report)
CREATE TABLE IF NOT EXISTS report_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule   TEXT NOT NULL,
  channels   JSONB NOT NULL DEFAULT '["email"]',
  threshold  JSONB,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_id, user_id)
);
