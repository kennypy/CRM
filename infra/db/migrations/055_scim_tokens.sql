-- Migration 055: SCIM provisioning tokens.
--
-- Bearer tokens identity providers (Okta, Azure AD, OneLogin) use to call the
-- SCIM 2.0 endpoint (/scim/v2/*, served by the auth service). The raw token is
-- shown once at creation; only its SHA-256 hash is stored. One token maps to
-- one tenant — the SCIM endpoint scopes every operation to it.

CREATE TABLE IF NOT EXISTS scim_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  token_prefix  TEXT NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scim_tokens_tenant ON scim_tokens (tenant_id);
