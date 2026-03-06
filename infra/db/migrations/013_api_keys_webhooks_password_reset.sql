-- Migration 013: API keys, outbound webhooks, and password reset tokens
--
-- API keys:        server-to-server authentication (hashed, shown once on creation)
-- Outbound webhooks: tenant-defined endpoints that receive CRM events
-- Password reset:  short-lived tokens for the forgot-password / reset-password flow

-- ── API keys ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                           -- human label ("CI/CD Pipeline", "Zapier")
  key_hash      TEXT NOT NULL UNIQUE,                    -- SHA-256 of the raw key (never store raw)
  key_prefix    TEXT NOT NULL,                           -- first 8 chars shown in UI (e.g. "nxc_abc1")
  scopes        TEXT[] NOT NULL DEFAULT '{"crm:read"}',  -- mirrors JWT scopes
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,                             -- NULL = no expiry
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant    ON api_keys (tenant_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash  ON api_keys (key_hash)  WHERE is_active = TRUE;

-- ── Outbound webhook endpoints ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  secret       TEXT NOT NULL,         -- HMAC-SHA256 signing secret (stored encrypted)
  event_types  TEXT[] NOT NULL,       -- e.g. '{"deal.created","contact.updated"}'
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_tenant
  ON outbound_webhooks (tenant_id)
  WHERE is_active = TRUE;

-- ── Outbound webhook delivery log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      UUID NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  attempt_count   INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending'   -- pending | delivered | failed | cancelled
                  CHECK (status IN ('pending','delivered','failed','cancelled')),
  last_response_status  INT,
  last_response_body    TEXT,
  last_error            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
  ON outbound_webhook_deliveries (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
  ON outbound_webhook_deliveries (webhook_id, created_at DESC);

-- ── Password reset tokens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,    -- SHA-256 of the raw token
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
  ON password_reset_tokens (token_hash)
  WHERE used_at IS NULL;

-- Auto-purge expired password reset tokens (keep table small)
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
  ON password_reset_tokens (expires_at)
  WHERE used_at IS NULL;
