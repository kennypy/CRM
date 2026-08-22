-- Migration 053: Enterprise forecasting — call/commit/best-case categories.
--
-- Reps assign each open deal a forecast category; managers can override the
-- committed amount per deal. The rollup endpoint aggregates by category in the
-- tenant's base currency (using exchange_rates from migration 052) alongside
-- the AI-predicted revenue, giving classic call/commit/best-case enterprise
-- forecasting on top of Reality-Score-driven predictions.

CREATE TABLE IF NOT EXISTS deal_forecasts (
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id          TEXT NOT NULL,          -- graph node id
  category         TEXT NOT NULL DEFAULT 'pipeline'
                   CHECK (category IN ('omitted', 'pipeline', 'best_case', 'commit', 'closed')),
  override_amount  NUMERIC(15, 2),         -- manager override, in tenant base currency
  notes            TEXT,
  updated_by       UUID REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_forecasts_tenant ON deal_forecasts (tenant_id, category);
