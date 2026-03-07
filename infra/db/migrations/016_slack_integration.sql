-- NexCRM Migration 016 — Slack Integration
-- Workspace connections, user mappings, and notification tracking.

-- ── Slack Workspace Connections ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slack_workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_id         TEXT NOT NULL,
  team_name       TEXT NOT NULL,
  bot_token_enc   TEXT NOT NULL,
  bot_user_id     TEXT NOT NULL,
  installed_by    UUID REFERENCES users(id),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, team_id)
);

CREATE TRIGGER sw_updated_at BEFORE UPDATE ON slack_workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Slack User Mappings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slack_user_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slack_user_id   TEXT NOT NULL,
  slack_email     TEXT,
  mapped_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- ── Slack Notification Log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slack_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  channel_id      TEXT,
  message_ts      TEXT,
  notification_type TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  payload         JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','actioned','escalated','expired','failed')),
  actioned_at     TIMESTAMPTZ,
  escalated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sn_tenant_status
  ON slack_notifications(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sn_entity
  ON slack_notifications(entity_type, entity_id);
