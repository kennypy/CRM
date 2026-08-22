-- Migration 050: Navigation tab groups.
--
-- Solves tab overload: admins define named tab groups (e.g. "Sales" →
-- contacts, companies, opportunities; "Marketing" → campaigns, leads) and
-- assign them to base roles and/or user profiles. Individual users can be
-- granted extra tabs on top of their group.
--
-- Resolution order for a user's nav (services/api-gateway/src/routes/nav.ts):
--   1. group listing the user's profile_id
--   2. group listing the user's base role
--   3. group flagged is_default
--   4. no group at all → the app's built-in full navigation
-- plus any per-user extra tabs.

CREATE TABLE IF NOT EXISTS nav_tab_groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  -- Ordered array of tab keys (route hrefs, validated against the catalog in
  -- the gateway nav route).
  tabs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Base roles this group applies to (admin, manager, rep, read_only).
  roles        TEXT[] NOT NULL DEFAULT '{}',
  -- user_profiles ids this group applies to (profile match wins over role).
  profile_ids  UUID[] NOT NULL DEFAULT '{}',
  is_default   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_nav_tab_groups_tenant ON nav_tab_groups(tenant_id, sort_order);

CREATE TRIGGER nav_tab_groups_updated_at BEFORE UPDATE ON nav_tab_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Per-user additions on top of the resolved group.
CREATE TABLE IF NOT EXISTS user_nav_tabs (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  extra_tabs  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);
