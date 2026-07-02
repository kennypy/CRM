-- Migration 026: Ingested Messages (reconciled / idempotent)
-- Deduplication tracking for Gmail/Outlook/external message ingestion.
-- Referenced by: services/graph-core/src/routes/activities.ts
--
-- NOTE: 002_entity_resolution_indexes.sql already creates an `ingested_messages`
-- table (with a different early shape). This migration therefore reconciles
-- rather than re-defines: it creates the table if absent, adds any missing
-- columns, and guards the unique constraint/indexes so it is safe whether or not
-- the earlier version exists.

CREATE TABLE IF NOT EXISTS ingested_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source          TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    entity_id       UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ingested_messages ADD COLUMN IF NOT EXISTS entity_id  UUID;
ALTER TABLE ingested_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Dedup constraint: only add if the table has no unique constraint yet (the
-- 002 version may already provide an equivalent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ingested_messages'::regclass AND contype = 'u'
  ) THEN
    ALTER TABLE ingested_messages
      ADD CONSTRAINT uq_ingested_messages_tenant_source_event
      UNIQUE (tenant_id, source, source_event_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ingested_messages_tenant ON ingested_messages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ingested_messages_entity ON ingested_messages (entity_id);
