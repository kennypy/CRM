-- Migration 033: Outbound delivery jobs for the Vintage partner API.
--
-- Every agent-originated action that must round-trip to Vintage (public
-- reply, resolve, assign) produces a support_outbound_jobs row. The
-- dispatcher worker claims pending jobs, posts to Vintage, and updates the
-- row's status. Agents see either the delivered state or a visibly stuck
-- state in the UI — never a silent failure.
--
-- State machine
--   pending    ── dispatcher claim ──▶ in_flight
--   in_flight  ── 2xx ───────────────▶ delivered   (terminal, happy)
--   in_flight  ── transient, inline budget left ─▶ pending   (bumps next_attempt_at)
--   in_flight  ── transient, budget exhausted ──▶ stuck
--   in_flight  ── permanent / auth error ───────▶ dead_letter (terminal, needs human)
--   stuck      ── reconcile claim ───▶ in_flight  (slow cadence; same rules thereafter)
--
-- The dispatcher also rescues in_flight rows whose last_attempt_at is older
-- than a grace window — crash recovery without needing a separate watchdog.

BEGIN;

CREATE TABLE IF NOT EXISTS support_outbound_jobs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id              UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,

  -- For replies, the message row that this job is attempting to deliver.
  -- NULL for resolve / assign jobs.
  message_id             UUID REFERENCES support_ticket_messages(id) ON DELETE CASCADE,

  kind                   TEXT NOT NULL CHECK (kind IN ('reply', 'resolve', 'assign')),

  -- Fully-formed request body captured at enqueue time. A later edit to the
  -- source message does not retroactively change what we send — agents
  -- would otherwise be surprised by in-flight drift.
  payload                JSONB NOT NULL,

  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                           'pending', 'in_flight', 'delivered', 'stuck', 'dead_letter')),

  attempts               INTEGER NOT NULL DEFAULT 0,
  next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at        TIMESTAMPTZ,
  last_error             TEXT,
  last_status_code       INTEGER,
  delivered_at           TIMESTAMPTZ,

  -- Wall-clock deadline for inline retries. Past this, dispatcher flips to
  -- 'stuck' and the slower reconcile worker takes over.
  inline_retry_deadline  TIMESTAMPTZ NOT NULL,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for the dispatcher's hot query. Narrows scan to rows that
-- could actually be picked up.
CREATE INDEX IF NOT EXISTS idx_outbound_jobs_dispatch
  ON support_outbound_jobs (next_attempt_at)
  WHERE status IN ('pending', 'in_flight', 'stuck');

CREATE INDEX IF NOT EXISTS idx_outbound_jobs_ticket_created
  ON support_outbound_jobs (ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_jobs_message
  ON support_outbound_jobs (message_id)
  WHERE message_id IS NOT NULL;

CREATE TRIGGER support_outbound_jobs_updated_at BEFORE UPDATE ON support_outbound_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
