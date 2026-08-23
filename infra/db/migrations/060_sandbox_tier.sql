-- Migration 060: sandbox tenant tier + email verification.
--
-- Public self-signup creates *sandbox* tenants: sample data only, wiped on a
-- schedule, never holding real client data. Two tenant columns mark the tier
-- and its expiry; users gain an email_verified_at gate (sandbox tenants are
-- unusable until the address is verified), backed by a verification-token
-- table mirroring password_reset_tokens.
--
-- email_verification_tokens deliberately has no tenant_id / RLS: like the
-- other auth token tables (see 043 header) it is accessed only by the
-- owner-role auth service and keyed by token hash.

-- ── Tenants: sandbox marker ───────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sandbox_expires_at TIMESTAMPTZ;

-- The reset job scans for expired sandboxes; keep that scan cheap.
CREATE INDEX IF NOT EXISTS idx_tenants_sandbox_expiry
  ON tenants (sandbox_expires_at)
  WHERE is_sandbox IS TRUE AND deleted_at IS NULL;

-- ── Users: email verification ─────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Backfill: every user that exists before this migration predates the
-- verification flow and was provisioned by a trusted path (seed, admin invite,
-- SSO). Only sandbox self-signups are ever gated on this column.
UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,    -- SHA-256 of the raw token
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_hash
  ON email_verification_tokens (token_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires
  ON email_verification_tokens (expires_at)
  WHERE used_at IS NULL;
