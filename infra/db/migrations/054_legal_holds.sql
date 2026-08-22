-- Migration 054: Legal holds.
--
-- An active legal hold suspends destruction of data in its scope:
--   * DELETE on held CRM records is refused (gateway blockLegalHold guard);
--   * GDPR/CCPA erasure DSRs matching a hold are denied with an explanatory
--     resolution (dsr-processor);
--   * retention policies must not purge held data (holds are checked before
--     any destructive retention action).
--
-- scope JSONB:
--   { "entityTypes": ["contact", ...],   -- empty/absent = all types
--     "entityIds": ["..."],              -- specific records; empty = whole types
--     "custodianEmails": ["a@x.com"] }   -- subjects whose erasure is blocked;
--                                        -- empty = every subject (tenant-wide)

CREATE TABLE IF NOT EXISTS legal_holds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  scope        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_by  UUID REFERENCES users(id),
  released_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_holds_tenant_active
  ON legal_holds (tenant_id) WHERE status = 'active';

-- The DSR processor and legal-hold endpoints record audit entries with a
-- metadata payload; 001 never defined the column, so those inserts failed.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata JSONB;
