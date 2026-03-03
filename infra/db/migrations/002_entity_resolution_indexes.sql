-- Migration 002: Fast lookup indexes for entity resolution
-- These denormalised tables let the ingestion worker resolve emails/domains
-- to AGE graph node IDs without executing a Cypher query per event.
-- They are kept in sync by the graph-core write path.

-- ── Person email → node_id index ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS person_email_index (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  email       TEXT NOT NULL,
  node_id     TEXT NOT NULL,   -- AGE graph node id (stored as text)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);

CREATE INDEX idx_person_email_lookup ON person_email_index (tenant_id, email)
  WHERE deleted_at IS NULL;

-- ── Company domain → node_id index ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_domain_index (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  domain      TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, domain)
);

CREATE INDEX idx_company_domain_lookup ON company_domain_index (tenant_id, domain)
  WHERE deleted_at IS NULL;

-- ── Ingestion deduplication (prevents processing same source message twice) ──
CREATE TABLE IF NOT EXISTS ingested_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  source          TEXT NOT NULL,     -- 'gmail', 'outlook', 'zoom', etc.
  source_event_id TEXT NOT NULL,     -- external message/event ID
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source, source_event_id)
);

CREATE INDEX idx_ingested_dedup ON ingested_messages (tenant_id, source, source_event_id);
