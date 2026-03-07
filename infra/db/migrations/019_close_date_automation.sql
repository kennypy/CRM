-- NexCRM Migration 019 — Close-Date Automation Configuration

CREATE TABLE IF NOT EXISTS automation_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  automation_key  TEXT NOT NULL,
  is_enabled      BOOLEAN NOT NULL DEFAULT true,
  config          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, automation_key)
);

CREATE TRIGGER automation_configs_updated_at BEFORE UPDATE ON automation_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
