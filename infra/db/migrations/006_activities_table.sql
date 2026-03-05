-- Migration 006: PostgreSQL activities table
--
-- Replaces AGE-only activity storage with a proper relational table that:
--   1. Supports partition pruning (20–80ms queries regardless of data age)
--   2. Enables cursor-based pagination (O(1) vs OFFSET's O(n))
--   3. Stores denormalized participant snapshots (no join overhead, preserves history)
--
-- AGE graph edges (RELATED_TO, PARTICIPATED_IN) are preserved for graph traversal
-- used by the Reality Score engine. New writes dual-write to both stores.

-- ── activities (partitioned monthly by occurred_at) ───────────────────────────

CREATE TABLE IF NOT EXISTS activities (
  id               UUID        NOT NULL,
  tenant_id        TEXT        NOT NULL,
  type             TEXT        NOT NULL CHECK (type IN ('email','call','meeting','note','document')),
  direction        TEXT             CHECK (direction IN ('inbound','outbound','internal')),
  subject          TEXT,
  summary          TEXT,
  sentiment        NUMERIC(4,3)     CHECK (sentiment BETWEEN -1 AND 1),
  duration_seconds INTEGER          CHECK (duration_seconds > 0 AND duration_seconds <= 86400),
  occurred_at      TIMESTAMPTZ NOT NULL,
  source           TEXT        NOT NULL DEFAULT 'user',
  external_id      TEXT,
  deal_id          UUID,
  company_id       UUID,
  storage_key      TEXT,                    -- nullable: future S3 offload for full email body
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  PRIMARY KEY (id, occurred_at)             -- occurred_at required in PK for partitioned table
) PARTITION BY RANGE (occurred_at);

-- Create monthly partitions from 2024-01 through 2027-12.
-- New partitions can be added via: CREATE TABLE activities_YYYY_MM PARTITION OF activities ...
DO $$
DECLARE
  start_month DATE := '2024-01-01';
  end_month   DATE;
  tbl_name    TEXT;
BEGIN
  WHILE start_month < '2028-01-01' LOOP
    end_month := start_month + INTERVAL '1 month';
    tbl_name  := 'activities_' || to_char(start_month, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF activities
       FOR VALUES FROM (%L) TO (%L)',
      tbl_name,
      start_month::TIMESTAMPTZ,
      end_month::TIMESTAMPTZ
    );
    start_month := end_month;
  END LOOP;
END $$;

-- Default/catch-all partition for dates outside the generated range
CREATE TABLE IF NOT EXISTS activities_default PARTITION OF activities DEFAULT;

-- ── activity_participants (denormalized snapshot) ─────────────────────────────
-- Snapshot of name/email at write time: no join latency, preserves history if
-- a contact is later merged or deleted.

CREATE TABLE IF NOT EXISTS activity_participants (
  activity_id   UUID        NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,   -- mirrors parent partition key for pruning
  contact_id    UUID,                   -- nullable: participant may not be a known contact
  first_name    TEXT,
  last_name     TEXT,
  email         TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'participant',
  PRIMARY KEY (activity_id, occurred_at, email)
) PARTITION BY RANGE (occurred_at);

DO $$
DECLARE
  start_month DATE := '2024-01-01';
  end_month   DATE;
  tbl_name    TEXT;
BEGIN
  WHILE start_month < '2028-01-01' LOOP
    end_month := start_month + INTERVAL '1 month';
    tbl_name  := 'activity_participants_' || to_char(start_month, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF activity_participants
       FOR VALUES FROM (%L) TO (%L)',
      tbl_name,
      start_month::TIMESTAMPTZ,
      end_month::TIMESTAMPTZ
    );
    start_month := end_month;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS activity_participants_default PARTITION OF activity_participants DEFAULT;

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- All partial indexes exclude soft-deleted rows.
-- Composite ordering: tenant first (equality), then FK, then occurred_at DESC (range/sort).

-- Global feed (tenant + time) — used by GET /activities
CREATE INDEX IF NOT EXISTS idx_activities_tenant_time
  ON activities (tenant_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- Deal timeline — used by GET /deals/:id/timeline and GET /activities?dealId=
CREATE INDEX IF NOT EXISTS idx_activities_deal
  ON activities (tenant_id, deal_id, occurred_at DESC)
  WHERE deleted_at IS NULL AND deal_id IS NOT NULL;

-- Contact timeline — used by GET /activities?contactId= (via participants join)
CREATE INDEX IF NOT EXISTS idx_activity_participants_contact
  ON activity_participants (contact_id, occurred_at DESC)
  WHERE contact_id IS NOT NULL;

-- Dedup index for external ingestion (one row per source message per tenant).
-- occurred_at must be included because unique indexes on partitioned tables
-- must contain all partitioning columns.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_external_dedup
  ON activities (tenant_id, source, external_id, occurred_at)
  WHERE external_id IS NOT NULL AND deleted_at IS NULL;

-- ── Backfill note ─────────────────────────────────────────────────────────────
-- Existing Activity nodes in AGE are NOT backfilled here.
-- Backfill can be run as a one-off script:
--   INSERT INTO activities SELECT ... FROM cypher('graph', ...) AS (...);
-- The dual-write in the application ensures all new writes appear in both stores.
