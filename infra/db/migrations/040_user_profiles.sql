-- 040_user_profiles.sql
-- User provisioning profiles (presets) + a per-user capabilities bag.
--
-- A "user profile" bundles a base role + a set of feature capabilities + default
-- timezone/language, so an admin can pick one when creating a user and have
-- everything auto-filled (e.g. "Sales Rep" → can quote + discount). Built-in
-- presets are seeded per tenant on first read and are editable.
--
-- capabilities are named feature flags (can_quote, can_discount, can_campaigns,
-- can_import, can_export) stored as a JSONB bag on both the profile and the
-- user. The existing users.can_quote column is mirrored from capabilities for
-- backward compatibility with the quoting flow.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS profile_id   UUID;

CREATE TABLE IF NOT EXISTS user_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  base_role        TEXT NOT NULL DEFAULT 'rep'
                   CHECK (base_role IN ('admin','manager','rep','read_only')),
  capabilities     JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_timezone TEXT,
  default_language TEXT,
  is_builtin       BOOLEAN NOT NULL DEFAULT false,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant ON user_profiles(tenant_id, sort_order);

CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
