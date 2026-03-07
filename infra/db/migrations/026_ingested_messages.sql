-- Migration 026: Ingested Messages
-- Deduplication tracking for Gmail/Outlook/external message ingestion.
-- Referenced by: services/graph-core/src/routes/activities.ts

CREATE TABLE IF NOT EXISTS ingested_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source          TEXT NOT NULL,          -- 'gmail', 'outlook', 'imap', etc.
    source_event_id TEXT NOT NULL,          -- external message/event ID for dedup
    entity_id       UUID,                   -- FK to activities.id (the created activity)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup constraint: one external message per tenant+source
ALTER TABLE ingested_messages
    ADD CONSTRAINT uq_ingested_messages_tenant_source_event
    UNIQUE (tenant_id, source, source_event_id);

CREATE INDEX idx_ingested_messages_tenant ON ingested_messages (tenant_id);
CREATE INDEX idx_ingested_messages_entity ON ingested_messages (entity_id);
