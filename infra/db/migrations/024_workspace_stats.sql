-- Unified workspace usage statistics.
-- Aggregates API calls, AI usage, outreach, and storage per month.

CREATE TABLE IF NOT EXISTS workspace_usage_stats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,               -- 'YYYY-MM'
  api_calls     INTEGER NOT NULL DEFAULT 0,
  ai_events     INTEGER NOT NULL DEFAULT 0,
  ai_tokens     BIGINT NOT NULL DEFAULT 0,
  emails_sent   INTEGER NOT NULL DEFAULT 0,
  calls_made    INTEGER NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period)
);

CREATE INDEX idx_workspace_usage_tenant_period ON workspace_usage_stats(tenant_id, period DESC);
