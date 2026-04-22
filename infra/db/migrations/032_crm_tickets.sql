-- Migration 032: External support tickets mirrored into the CRM
--
-- Stores tickets received from upstream sources (initially Vintage.br) via the
-- inbound webhook at POST /webhooks/vintage. Tickets are keyed by
-- (source, source_ticket_id) so re-deliveries of the same upstream ticket
-- are idempotent — the existing external_ticket_id is returned to the sender
-- and the row is left unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS crm_tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Upstream identity
  source              TEXT NOT NULL,
  source_ticket_id    TEXT NOT NULL,
  source_user_id      TEXT,

  -- ID surfaced back to the sender for cross-referencing.
  -- Format: "VNT-000123" for Vintage; sequential per source.
  external_ticket_id  TEXT NOT NULL UNIQUE,

  -- Ticket content (validated at the route boundary by Zod)
  subject             TEXT NOT NULL,
  body                TEXT NOT NULL,
  category            TEXT NOT NULL CHECK (category IN (
                        'ORDER_ISSUE','PAYMENT','SHIPPING','REFUND',
                        'ACCOUNT','LISTING','FRAUD','OTHER')),
  priority            TEXT NOT NULL CHECK (priority IN (
                        'LOW','NORMAL','HIGH','URGENT')),
  order_id            TEXT,

  -- CRM-side state
  status              TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                        'OPEN','IN_PROGRESS','RESOLVED','CLOSED')),

  -- Timestamps
  source_created_at   TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency key — must be unique per source.
  UNIQUE (source, source_ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_tickets_status_created
  ON crm_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_tickets_category
  ON crm_tickets (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_tickets_priority
  ON crm_tickets (priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_tickets_source_user
  ON crm_tickets (source, source_user_id);

CREATE TRIGGER crm_tickets_updated_at BEFORE UPDATE ON crm_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Sequence used to mint external_ticket_id values like "VNT-000001".
-- Kept separate from the PK so the surfaced ID is short and human-friendly
-- without leaking row counts across sources.
CREATE SEQUENCE IF NOT EXISTS crm_tickets_vintage_seq START 1;

-- Internal CRM notes attached to a ticket — only visible inside the CRM.
CREATE TABLE IF NOT EXISTS crm_ticket_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES crm_tickets(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_ticket_notes_ticket
  ON crm_ticket_notes (ticket_id, created_at DESC);

COMMIT;
