-- Migration 014: Phase 2 features — lead scoring, marketplace, anomaly detection, Zoom/Slack ingestion
--
-- lead_scores:         AI-computed lead scores with factor breakdown
-- marketplace_apps:    partner integration app definitions
-- marketplace_installs: per-tenant app installations
-- anomaly_alerts:      AI-detected anomalies on deals/accounts
-- predictive_forecasts: predictive close probability per deal
-- zoom_meetings:       cached Zoom transcript metadata
-- slack_channels:      monitored Slack channels

-- ── Lead Scores ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      TEXT NOT NULL,           -- graph node ID
  score           INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  tier            TEXT NOT NULL CHECK (tier IN ('hot', 'warm', 'cold')),
  factors         JSONB NOT NULL DEFAULT '[]',
  model_version   TEXT NOT NULL DEFAULT 'v1',
  calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_scores_contact
  ON lead_scores (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_tier
  ON lead_scores (tenant_id, tier, score DESC);

-- ── Predictive Forecasts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS predictive_forecasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id         TEXT NOT NULL,           -- graph node ID
  predicted_close_probability  NUMERIC(5,2) NOT NULL CHECK (predicted_close_probability BETWEEN 0 AND 100),
  predicted_close_date         DATE,
  predicted_value              NUMERIC(15,2),
  confidence_interval_low      NUMERIC(5,2),
  confidence_interval_high     NUMERIC(5,2),
  factors         JSONB NOT NULL DEFAULT '[]',
  model_version   TEXT NOT NULL DEFAULT 'v1',
  calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_predictive_forecasts_deal
  ON predictive_forecasts (tenant_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_predictive_forecasts_tenant
  ON predictive_forecasts (tenant_id, calculated_at DESC);

-- ── Anomaly Alerts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('deal', 'contact', 'company')),
  entity_id       TEXT NOT NULL,           -- graph node ID
  alert_type      TEXT NOT NULL CHECK (alert_type IN (
    'stalled_deal', 'at_risk_account', 'engagement_drop',
    'champion_left', 'competitor_mention', 'budget_cut_signal',
    'unusual_activity', 'ghost_deal'
  )),
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  evidence        JSONB NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  model_version   TEXT NOT NULL DEFAULT 'v1',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_tenant_status
  ON anomaly_alerts (tenant_id, status, severity DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_entity
  ON anomaly_alerts (entity_type, entity_id, created_at DESC);

-- ── Marketplace Apps ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_apps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  short_description TEXT,
  icon_url        TEXT,
  publisher       TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
    'communication', 'productivity', 'analytics',
    'data_enrichment', 'marketing', 'support', 'finance', 'custom'
  )),
  auth_type       TEXT NOT NULL DEFAULT 'oauth2' CHECK (auth_type IN ('oauth2', 'api_key', 'webhook', 'none')),
  config_schema   JSONB NOT NULL DEFAULT '{}',     -- JSON Schema for install-time config
  webhook_url     TEXT,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  is_published    BOOLEAN NOT NULL DEFAULT false,
  version         TEXT NOT NULL DEFAULT '1.0.0',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_apps_category
  ON marketplace_apps (category) WHERE is_published = TRUE;

-- ── Marketplace Installs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_installs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_id          UUID NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  installed_by    UUID NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error', 'uninstalled')),
  config          JSONB NOT NULL DEFAULT '{}',     -- tenant-specific config values
  credentials     JSONB NOT NULL DEFAULT '{}',     -- encrypted tokens / API keys
  last_synced_at  TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_installs_tenant
  ON marketplace_installs (tenant_id) WHERE status = 'active';

-- ── Seed initial marketplace apps (5 partner integrations) ──────────────────
INSERT INTO marketplace_apps (slug, name, description, short_description, icon_url, publisher, category, auth_type, config_schema, is_published) VALUES
  ('zoom', 'Zoom', 'Automatically ingest and transcribe Zoom meeting recordings. Extract action items, sentiment, and buying signals from sales calls.', 'Zoom meeting transcription & analysis', '/marketplace/zoom.svg', 'NexCRM', 'communication', 'oauth2', '{"type":"object","properties":{"auto_record":{"type":"boolean","default":true},"transcript_language":{"type":"string","default":"en"}}}', true),
  ('slack', 'Slack', 'Monitor Slack channels for deal mentions, customer requests, and team collaboration signals. Auto-capture activities from Slack conversations.', 'Slack channel monitoring & signal capture', '/marketplace/slack.svg', 'NexCRM', 'communication', 'oauth2', '{"type":"object","properties":{"channels":{"type":"array","items":{"type":"string"}},"mention_keywords":{"type":"array","items":{"type":"string"}}}}', true),
  ('clearbit', 'Clearbit Enrichment', 'Enrich contacts and companies with firmographic, technographic, and demographic data from Clearbit. Auto-fill missing fields on new records.', 'Contact & company data enrichment', '/marketplace/clearbit.svg', 'Clearbit', 'data_enrichment', 'api_key', '{"type":"object","properties":{"auto_enrich":{"type":"boolean","default":true},"enrich_on_create":{"type":"boolean","default":true}}}', true),
  ('hubspot-import', 'HubSpot Import', 'One-click migration from HubSpot CRM. Import contacts, companies, deals, and activities with field mapping and deduplication.', 'Migrate from HubSpot CRM', '/marketplace/hubspot.svg', 'NexCRM', 'productivity', 'api_key', '{"type":"object","properties":{"import_contacts":{"type":"boolean","default":true},"import_deals":{"type":"boolean","default":true},"import_activities":{"type":"boolean","default":true}}}', true),
  ('mailchimp', 'Mailchimp', 'Sync contacts and segments with Mailchimp for email marketing campaigns. Track email engagement as CRM activities.', 'Email marketing sync & engagement tracking', '/marketplace/mailchimp.svg', 'Mailchimp', 'marketing', 'api_key', '{"type":"object","properties":{"sync_direction":{"type":"string","enum":["push","pull","bidirectional"],"default":"bidirectional"},"sync_tags":{"type":"boolean","default":true}}}', true)
ON CONFLICT (slug) DO NOTHING;

-- ── Triggers ────────────────────────────────────────────────────────────────
CREATE TRIGGER lead_scores_updated_at BEFORE UPDATE ON lead_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER anomaly_alerts_updated_at BEFORE UPDATE ON anomaly_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER marketplace_apps_updated_at BEFORE UPDATE ON marketplace_apps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER marketplace_installs_updated_at BEFORE UPDATE ON marketplace_installs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
