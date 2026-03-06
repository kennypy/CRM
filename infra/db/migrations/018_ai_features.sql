-- NexCRM Migration 018 — AI Features (Enrichment, Forecasting, Meeting Summaries)

-- ── Enrichment Jobs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'internal',
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','skipped')),
  input_data      JSONB DEFAULT '{}',
  result_data     JSONB DEFAULT '{}',
  confidence      NUMERIC(4,3),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_enrichment_entity
  ON enrichment_jobs(entity_type, entity_id);

-- ── AI Forecast Snapshots ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_forecast_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,
  pipeline_data   JSONB NOT NULL,
  forecast_data   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_afs_tenant
  ON ai_forecast_snapshots(tenant_id, created_at DESC);

-- ── Meeting Summaries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_summaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id     UUID,
  source          TEXT NOT NULL DEFAULT 'zoom',
  transcript      TEXT,
  summary         TEXT,
  action_items    JSONB DEFAULT '[]',
  participants    JSONB DEFAULT '[]',
  sentiment       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
