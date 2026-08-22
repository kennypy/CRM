-- Migration 048: Export job tracking.
-- Large tenant exports run asynchronously on the "export" BullMQ queue; this
-- table lets the caller poll GET /api/v1/export/:jobId for status + URL.
-- (Previously queued exports were enqueued but nothing consumed the queue and
-- no status record existed.)

CREATE TABLE IF NOT EXISTS export_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by  UUID REFERENCES users(id),
  format        TEXT NOT NULL CHECK (format IN ('json', 'csv')),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  download_url  TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant
  ON export_jobs (tenant_id, created_at DESC);
