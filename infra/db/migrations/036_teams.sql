-- 036_teams.sql
-- First-class Teams object.
--
-- The permission model (015) already referenced teams — record_permissions
-- accepts grantee_type='team' and record_permission_defaults has a team_access
-- column — but there was no teams table, no membership, and the ACL never
-- resolved team grants. These tables make Teams a real, grantable object:
-- record shares to a team now resolve through membership (see record-access.ts).

CREATE TABLE IF NOT EXISTS teams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_tenant ON teams(tenant_id);

CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS team_members (
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_lead      BOOLEAN NOT NULL DEFAULT false,  -- team lead / manager of the team
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
