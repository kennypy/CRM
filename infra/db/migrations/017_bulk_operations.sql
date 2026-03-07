-- NexCRM Migration 017 — Bulk Operations (Import Jobs)

CREATE TABLE IF NOT EXISTS import_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  entity_type     TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_format     TEXT NOT NULL CHECK (file_format IN ('csv','xlsx','json')),
  column_mapping  JSONB,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','mapping','processing','completed','failed','cancelled')),
  total_rows      INT,
  processed_rows  INT DEFAULT 0,
  created_rows    INT DEFAULT 0,
  updated_rows    INT DEFAULT 0,
  skipped_rows    INT DEFAULT 0,
  error_rows      INT DEFAULT 0,
  errors          JSONB DEFAULT '[]',
  dedup_field     TEXT DEFAULT 'email',
  storage_key     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant
  ON import_jobs(tenant_id, created_at DESC);

CREATE TRIGGER import_jobs_updated_at BEFORE UPDATE ON import_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
