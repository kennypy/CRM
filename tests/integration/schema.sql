-- Minimal relational schema for the ingestion/anomaly integration tests.
-- This is the subset of the production migrations that the pipeline and anomaly
-- detector actually touch, with the Apache AGE / pgvector bits omitted so the
-- tests run against a stock PostgreSQL 16 instance.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Test'
);
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  email TEXT
);

CREATE TABLE IF NOT EXISTS crm_events (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id UUID,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);
CREATE TABLE IF NOT EXISTS crm_events_default PARTITION OF crm_events DEFAULT;
CREATE INDEX IF NOT EXISTS idx_crm_events_tenant ON crm_events(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  extraction_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','auto_approved')),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  summary TEXT NOT NULL,
  proposed_changes JSONB NOT NULL,
  evidence TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('deal','contact','company')),
  entity_id TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('stalled_deal','at_risk_account','engagement_drop','champion_left','competitor_mention','budget_cut_signal','unusual_activity','ghost_deal')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  model_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS person_email_index (
  tenant_id UUID NOT NULL, email TEXT NOT NULL, node_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, email)
);
CREATE TABLE IF NOT EXISTS company_domain_index (
  tenant_id UUID NOT NULL, domain TEXT NOT NULL, node_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, domain)
);
