-- Migration 030: Marketing campaigns table and marketing fields support
--
-- Campaigns are stored in PostgreSQL (not graph) because they are
-- tenant-level operational objects, not relationship entities.
-- Marketing fields on contacts/companies/deals live on graph node properties
-- (schema-free) so no migration needed for those.

BEGIN;

-- ── Campaigns table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  description   TEXT,
  type          TEXT NOT NULL DEFAULT 'email'
    CHECK (type IN ('email','social','event','webinar','content','paid_search','paid_social','abm','referral','other')),
  status        TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','active','paused','completed','archived')),
  channel       TEXT
    CHECK (channel IS NULL OR channel IN ('email','linkedin','facebook','google','twitter','instagram','webinar','event','sms','direct_mail','other')),

  start_date    TIMESTAMPTZ,
  end_date      TIMESTAMPTZ,
  budget        NUMERIC(14,2),
  actual_spend  NUMERIC(14,2) DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',

  target_audience TEXT,
  goals           TEXT,
  owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Aggregate metrics (updated by integrations or manually)
  sent          INT NOT NULL DEFAULT 0,
  delivered     INT NOT NULL DEFAULT 0,
  opened        INT NOT NULL DEFAULT 0,
  clicked       INT NOT NULL DEFAULT 0,
  converted     INT NOT NULL DEFAULT 0,
  unsubscribed  INT NOT NULL DEFAULT 0,
  bounced       INT NOT NULL DEFAULT 0,
  leads_generated INT NOT NULL DEFAULT 0,
  mqls          INT NOT NULL DEFAULT 0,
  sqls          INT NOT NULL DEFAULT 0,
  opportunities INT NOT NULL DEFAULT 0,
  closed_won    INT NOT NULL DEFAULT 0,
  revenue       NUMERIC(14,2) NOT NULL DEFAULT 0,

  tags          JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX idx_campaigns_status ON campaigns(tenant_id, status);
CREATE INDEX idx_campaigns_type   ON campaigns(tenant_id, type);
CREATE INDEX idx_campaigns_dates  ON campaigns(tenant_id, start_date, end_date);

-- ── Campaign-Contact junction (many-to-many enrollment) ─────────────────────
CREATE TABLE IF NOT EXISTS campaign_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id   TEXT NOT NULL,  -- graph node ID (string)
  status       TEXT NOT NULL DEFAULT 'enrolled'
    CHECK (status IN ('enrolled','sent','opened','clicked','converted','unsubscribed','bounced')),
  enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX idx_campaign_contacts_campaign ON campaign_contacts(campaign_id);
CREATE INDEX idx_campaign_contacts_contact  ON campaign_contacts(contact_id);

-- ── Updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_campaigns_updated_at();

COMMIT;
