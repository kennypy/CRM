-- Migration 051: Per-tenant encryption keys (envelope encryption).
--
-- Each tenant gets a random 256-bit data-encryption key (DEK), stored wrapped
-- (AES-256-GCM) by the master key-encryption key (TENANT_KEK env var, falling
-- back to OAUTH_ENCRYPTION_KEY). Secrets encrypted with a tenant DEK carry a
-- "t1:<version>:" prefix; legacy values encrypted with the shared key keep
-- decrypting via the shared secret-crypto fallback. Rotating a tenant's KEK
-- wrap bumps key_version. See packages/service-common/src/tenant-crypto.ts.

CREATE TABLE IF NOT EXISTS tenant_encryption_keys (
  tenant_id    UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  wrapped_dek  TEXT NOT NULL,          -- hex iv:tag:ciphertext, wrapped by the KEK
  key_version  INT  NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at   TIMESTAMPTZ
);
