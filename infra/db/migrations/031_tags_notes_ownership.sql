-- Migration 031: Entity tags and notes tables
--
-- Tags and notes are cross-entity features (contacts, companies, deals, leads).
-- Stored in PostgreSQL as relational tables. Entity IDs reference graph nodes
-- (string IDs) or PG UUIDs depending on entity type.

BEGIN;

-- ── Entity Tags ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact','company','deal','lead')),
  entity_id   TEXT NOT NULL,
  tag         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(tenant_id, entity_type, entity_id, tag)
);

CREATE INDEX idx_entity_tags_lookup
  ON entity_tags(tenant_id, entity_type, entity_id);
CREATE INDEX idx_entity_tags_by_tag
  ON entity_tags(tenant_id, entity_type, tag);

-- ── Entity Notes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact','company','deal','lead')),
  entity_id   TEXT NOT NULL,
  content     TEXT NOT NULL,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  pinned      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entity_notes_lookup
  ON entity_notes(tenant_id, entity_type, entity_id);

-- ── Entity Lists (static & dynamic segments) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  list_type       TEXT NOT NULL DEFAULT 'static' CHECK (list_type IN ('static','dynamic')),
  entity_type     TEXT NOT NULL DEFAULT 'contact' CHECK (entity_type IN ('contact','company','deal','lead')),
  filter_criteria JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_list_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id   UUID NOT NULL REFERENCES entity_lists(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(list_id, entity_id)
);

CREATE INDEX idx_entity_lists_tenant ON entity_lists(tenant_id, entity_type);
CREATE INDEX idx_entity_list_members_list ON entity_list_members(list_id);

-- ── Pipeline Definitions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  stages      JSONB NOT NULL DEFAULT '[]',
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_defs_tenant ON pipeline_definitions(tenant_id);

-- ── Campaign Templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  type           TEXT NOT NULL DEFAULT 'email',
  channel        TEXT,
  default_budget NUMERIC(14,2),
  content        JSONB NOT NULL DEFAULT '{}',
  tags           JSONB NOT NULL DEFAULT '[]',
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_templates_tenant ON campaign_templates(tenant_id);

-- ── Email Templates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  category    TEXT,
  variables   TEXT[] NOT NULL DEFAULT '{}',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_templates_tenant ON email_templates(tenant_id);

-- ── Campaign approval fields ──────────────────────────────────────────────────
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'none'
  CHECK (approval_status IN ('none','pending','approved','rejected'));
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ── Campaign A/B testing ──────────────────────────────────────────────────────
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_test JSONB;

-- ── Updated_at triggers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_entity_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_entity_notes_updated_at
  BEFORE UPDATE ON entity_notes
  FOR EACH ROW EXECUTE FUNCTION update_entity_notes_updated_at();

COMMIT;
