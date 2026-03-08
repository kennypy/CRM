-- NexCRM Migration 014 — Custom Objects & Custom Fields
-- Enables admin-defined custom fields on all entity types and custom object types.

-- ── Custom Field Definitions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN (
    'contact','company','deal','activity','task','custom_object'
  )),
  custom_object_id UUID,
  field_key       TEXT NOT NULL,
  field_label     TEXT NOT NULL,
  field_type      TEXT NOT NULL CHECK (field_type IN (
    'text','number','date','datetime','boolean','enum','multi_enum',
    'url','email','phone','currency','lookup','formula'
  )),
  field_options   JSONB NOT NULL DEFAULT '{}',
  validations     JSONB NOT NULL DEFAULT '{}',
  default_value   TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  is_required     BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, entity_type, custom_object_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_cfd_tenant_entity
  ON custom_field_definitions(tenant_id, entity_type) WHERE is_active;

CREATE TRIGGER cfd_updated_at BEFORE UPDATE ON custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Custom Object Definitions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_object_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_key      TEXT NOT NULL,
  object_label    TEXT NOT NULL,
  object_label_plural TEXT NOT NULL,
  icon            TEXT DEFAULT 'box',
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, object_key)
);

CREATE TRIGGER cod_updated_at BEFORE UPDATE ON custom_object_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Custom Object Associations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_object_associations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  custom_object_id UUID NOT NULL REFERENCES custom_object_definitions(id) ON DELETE CASCADE,
  target_entity_type TEXT NOT NULL,
  relationship_type  TEXT NOT NULL DEFAULT 'many_to_one'
    CHECK (relationship_type IN ('one_to_one','one_to_many','many_to_one','many_to_many')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Custom Object Records ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_object_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_id       UUID NOT NULL REFERENCES custom_object_definitions(id) ON DELETE CASCADE,
  data            JSONB NOT NULL DEFAULT '{}',
  owner_id        UUID REFERENCES users(id),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cor_tenant_obj
  ON custom_object_records(tenant_id, object_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cor_data
  ON custom_object_records USING GIN(data);

CREATE TRIGGER cor_updated_at BEFORE UPDATE ON custom_object_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Custom Object Links ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_object_links (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  association_id     UUID NOT NULL REFERENCES custom_object_associations(id) ON DELETE CASCADE,
  record_id          UUID NOT NULL REFERENCES custom_object_records(id) ON DELETE CASCADE,
  linked_entity_type TEXT NOT NULL,
  linked_entity_id   UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_col_record ON custom_object_links(record_id);
CREATE INDEX IF NOT EXISTS idx_col_linked ON custom_object_links(linked_entity_type, linked_entity_id);

-- ── Add custom_fields JSONB to relational entity tables ─────────────────────────
ALTER TABLE activities ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
-- Note: contacts/companies/deals are AGE graph nodes — custom_fields stored as node properties
