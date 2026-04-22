-- Migration 032: Support tickets mirrored from external marketplaces
--
-- Agent workspace for Vintage.br's support queue. Vintage emits inbound
-- webhooks to /webhooks/vintage; this schema owns the data model for the
-- agent-facing triage / reply / resolve workflow.
--
-- Key invariants:
--   * Idempotency on the inbound webhook is enforced by two unique keys —
--       (source, source_ticket_id)        for ticket.opened
--       (source, source_message_id)       for ticket.user_replied
--     Vintage does NOT retry; a nightly reconcile cron heals any drift,
--     but the receiver must succeed on first valid delivery.
--   * Internal notes live in support_ticket_messages with
--     role = 'internal_note'. They MUST NEVER be forwarded to Vintage —
--     the outbound client filters on role.
--   * support_webhook_deliveries is an append-only audit log used for
--     replay and debugging. It stores the raw body for replay; access is
--     sensitive (customer PII) and should be retention-capped
--     operationally.

BEGIN;

-- ── support_tickets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Upstream identity
  source                   TEXT NOT NULL,
  source_ticket_id         TEXT NOT NULL,
  source_user_id           TEXT NOT NULL,
  source_user_name         TEXT NOT NULL,
  source_user_email        TEXT NOT NULL,

  -- ID surfaced back to the sender for cross-referencing.
  -- Format: "VNT-000123" for Vintage; sequential per source.
  external_ticket_id       TEXT NOT NULL UNIQUE,

  -- Ticket-level attributes from the open event (immutable)
  subject                  TEXT NOT NULL,
  category                 TEXT NOT NULL CHECK (category IN (
                             'ORDER_ISSUE','PAYMENT','SHIPPING','REFUND',
                             'ACCOUNT','LISTING','FRAUD','OTHER')),
  priority                 TEXT NOT NULL CHECK (priority IN (
                             'LOW','NORMAL','HIGH','URGENT')),
  order_id                 TEXT,

  -- CRM-side workflow — independent from Vintage's user-visible status.
  status                   TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN (
                             'NEW','TRIAGED','IN_REVIEW','WAITING_USER',
                             'ESCALATED','CLOSED')),
  assignee_id              UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Activity timestamps
  opened_at                TIMESTAMPTZ NOT NULL,
  last_user_activity_at    TIMESTAMPTZ NOT NULL,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, source_ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_activity
  ON support_tickets (status, last_user_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assignee_status
  ON support_tickets (assignee_id, status)
  WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority
  ON support_tickets (priority, last_user_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_source_user
  ON support_tickets (source, source_user_id);

CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Per-source sequence for external_ticket_id minting. Kept separate from the
-- PK so the surfaced ID is short and human-friendly ("VNT-000001") without
-- leaking row counts across sources.
CREATE SEQUENCE IF NOT EXISTS support_tickets_vintage_seq START 1;

-- ── support_ticket_messages ─────────────────────────────────────────────────
-- One row per message in a ticket thread: the user's opening body, each
-- user reply, each agent reply, and each internal note. Role discriminates.
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id                UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,

  role                     TEXT NOT NULL CHECK (role IN (
                             'user','agent','internal_note')),

  -- Upstream id for user-origin messages (null for agent replies and
  -- internal notes). UNIQUE per source so re-deliveries are idempotent.
  source                   TEXT,
  source_message_id        TEXT,

  body                     TEXT NOT NULL,
  attachment_urls          TEXT[] NOT NULL DEFAULT '{}',

  -- Display name shown to the user on Vintage for agent replies, or the
  -- user's own display name for user messages. Internal notes default to
  -- the authoring agent's name but aren't surfaced to Vintage.
  sender_name              TEXT NOT NULL,
  -- FK to users.id when role = 'agent' or 'internal_note'.
  author_id                UUID REFERENCES users(id) ON DELETE SET NULL,

  -- When the outbound delivery to Vintage succeeded, for agent replies.
  -- Null for user messages and internal notes.
  delivered_at             TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- User-origin messages are deduped on (source, source_message_id).
  -- Agent messages and internal notes have source_message_id = NULL and
  -- are freely insertable.
  UNIQUE (source, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
  ON support_ticket_messages (ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_support_messages_role
  ON support_ticket_messages (ticket_id, role, created_at ASC);

-- ── support_webhook_deliveries ──────────────────────────────────────────────
-- Append-only log of every inbound webhook request, regardless of outcome,
-- used for replay and investigation. Raw body is PII-bearing — apply row-
-- level retention operationally (e.g. 30d).
CREATE TABLE IF NOT EXISTS support_webhook_deliveries (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source                   TEXT NOT NULL,
  event                    TEXT,        -- null if body could not be parsed
  source_ticket_id         TEXT,
  source_message_id        TEXT,

  -- sha256 hex digest of the raw body — safe to log / compare across
  -- re-deliveries without exposing PII.
  body_digest              TEXT NOT NULL,
  -- Raw request body, PII-bearing. Nullable so signature-failing deliveries
  -- (which we have no reason to trust and no reason to replay) can be
  -- stored without their body.
  raw_body                 TEXT,

  signature_valid          BOOLEAN NOT NULL,
  status_code              INTEGER NOT NULL,
  error                    TEXT,
  -- Ticket the delivery ended up attached to, if any. Useful for querying
  -- "show me every inbound event for this ticket" during an incident.
  ticket_id                UUID REFERENCES support_tickets(id) ON DELETE SET NULL,

  received_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_source_ticket
  ON support_webhook_deliveries (source, source_ticket_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event
  ON support_webhook_deliveries (event, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ticket
  ON support_webhook_deliveries (ticket_id, received_at DESC)
  WHERE ticket_id IS NOT NULL;

COMMIT;
