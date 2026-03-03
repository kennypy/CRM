-- NexCRM Core Schema Migration 001
-- Relational tables for multi-tenancy, auth, events, and metadata.
-- Graph nodes/edges live in Apache AGE (nexcrm_graph).

-- ── Tenants ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  domain          TEXT,
  plan            TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'growth', 'enterprise')),
  data_region     TEXT NOT NULL DEFAULT 'us' CHECK (data_region IN ('us', 'eu', 'apac')),
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  password_hash   TEXT,                        -- NULL if OAuth-only
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'rep'
                  CHECK (role IN ('super_admin', 'admin', 'manager', 'rep', 'read_only')),
  avatar_url      TEXT,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- ── OAuth Tokens ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'slack', 'zoom')),
  access_token    TEXT NOT NULL,               -- encrypted at app layer
  refresh_token   TEXT,
  expires_at      TIMESTAMPTZ,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, provider)
);

-- ── Refresh Tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,        -- SHA-256 hash of the actual token
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ── Event Stream (audit + ingestion) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_events (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  event_type      TEXT NOT NULL,
  source          TEXT NOT NULL,
  actor_id        UUID,
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create initial monthly partitions
CREATE TABLE crm_events_2025_01 PARTITION OF crm_events
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE crm_events_2025_02 PARTITION OF crm_events
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE crm_events_2025_03 PARTITION OF crm_events
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE crm_events_2026_01 PARTITION OF crm_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE crm_events_2026_02 PARTITION OF crm_events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE crm_events_2026_03 PARTITION OF crm_events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE crm_events_default PARTITION OF crm_events DEFAULT;

CREATE INDEX idx_crm_events_tenant ON crm_events(tenant_id, created_at DESC);
CREATE INDEX idx_crm_events_entity ON crm_events(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_crm_events_type ON crm_events(event_type, created_at DESC);

-- ── Review Queue ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  extraction_id       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'auto_approved')),
  confidence          NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  summary             TEXT NOT NULL,
  proposed_changes    JSONB NOT NULL,
  evidence            TEXT,
  reviewed_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_review_queue_tenant_status ON review_queue(tenant_id, status, created_at DESC);

-- ── Embeddings (pgvector) ─────────────────────────────────────────────────────
-- Only created when pgvector extension is available (skipped in dev without it)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS node_embeddings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL,
      node_id         TEXT NOT NULL,
      node_label      TEXT NOT NULL,
      embedding       vector(1536) NOT NULL,
      content_hash    TEXT NOT NULL,
      model           TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, node_id)
    );
    -- HNSW index for approximate nearest-neighbor search
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'idx_node_embeddings_hnsw'
    ) THEN
      CREATE INDEX idx_node_embeddings_hnsw ON node_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    END IF;
  END IF;
END
$$;

-- ── Integration State ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error', 'disconnected')),
  last_synced_at  TIMESTAMPTZ,
  error_message   TEXT,
  config          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Workflow Definitions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger         JSONB NOT NULL,
  conditions      JSONB NOT NULL DEFAULT '[]',
  actions         JSONB NOT NULL DEFAULT '[]',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  version         INTEGER NOT NULL DEFAULT 1,
  environment     TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('dev', 'staging', 'production')),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Workflow Runs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  workflow_id     UUID NOT NULL REFERENCES workflow_definitions(id),
  trigger_event   JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  steps_log       JSONB NOT NULL DEFAULT '[]',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error_message   TEXT
);

-- ── Audit Log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID,
  action          TEXT NOT NULL,               -- 'contact.updated', 'deal.deleted', etc.
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  before_state    JSONB,
  after_state     JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_log_2026_q1 PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE audit_log_2026_q2 PARTITION OF audit_log
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id, created_at DESC);

-- ── Update timestamp trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER review_queue_updated_at BEFORE UPDATE ON review_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER integrations_updated_at BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER workflow_definitions_updated_at BEFORE UPDATE ON workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
