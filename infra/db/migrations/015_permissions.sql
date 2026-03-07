-- NexCRM Migration 015 — Record-level + Field-level Permissions
-- Full ACL system with per-record access control and per-role field visibility.

-- ── Record-level ACLs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  grantee_type    TEXT NOT NULL CHECK (grantee_type IN ('user','role','team')),
  grantee_id      TEXT NOT NULL,
  can_read        BOOLEAN NOT NULL DEFAULT true,
  can_write       BOOLEAN NOT NULL DEFAULT false,
  can_delete      BOOLEAN NOT NULL DEFAULT false,
  granted_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rp_unique
  ON record_permissions(tenant_id, entity_type, entity_id, grantee_type, grantee_id);
CREATE INDEX IF NOT EXISTS idx_rp_entity
  ON record_permissions(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_rp_grantee
  ON record_permissions(tenant_id, grantee_type, grantee_id);

-- ── Field-level Permissions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  field_name      TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('super_admin','admin','manager','rep','read_only')),
  access_level    TEXT NOT NULL DEFAULT 'read_write'
    CHECK (access_level IN ('hidden','read_only','read_write')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, entity_type, field_name, role)
);

CREATE INDEX IF NOT EXISTS idx_fp_tenant_entity
  ON field_permissions(tenant_id, entity_type);

CREATE TRIGGER fp_updated_at BEFORE UPDATE ON field_permissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Default Permission Rules ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_permission_defaults (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  owner_access    TEXT NOT NULL DEFAULT 'read_write_delete',
  team_access     TEXT NOT NULL DEFAULT 'read',
  org_access      TEXT NOT NULL DEFAULT 'none',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, entity_type)
);

CREATE TRIGGER rpd_updated_at BEFORE UPDATE ON record_permission_defaults
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
