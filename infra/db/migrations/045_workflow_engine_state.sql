-- NexCRM Migration 045 — Workflow engine durable cursor
-- The workflow engine polled crm_events using an in-memory `lastProcessedAt`
-- initialised to now() on every start, so any event created during a
-- deploy/crash window was permanently skipped. Persist the cursor so the
-- engine resumes exactly where it left off.

CREATE TABLE IF NOT EXISTS workflow_engine_state (
  id                 BOOLEAN PRIMARY KEY DEFAULT TRUE,   -- single-row guard
  last_processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_engine_state_singleton CHECK (id)
);

-- Seed the single row (idempotent).
INSERT INTO workflow_engine_state (id) VALUES (TRUE)
  ON CONFLICT (id) DO NOTHING;

-- The engine runs as the BYPASSRLS service role; grant it access. This is an
-- engine-global table (no tenant_id → no RLS policy needed).
GRANT SELECT, INSERT, UPDATE ON workflow_engine_state TO nexcrm_service;
