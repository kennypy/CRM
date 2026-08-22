-- Migration 052: Multi-currency — per-tenant exchange rates.
--
-- Each tenant maintains a rate table against its default_currency (base):
-- `rate` = units of `currency` per 1 unit of the base currency.
-- Conversion happens in the API gateway (lib/currency.ts): amounts recorded in
-- a deal/quote currency are converted into the tenant base for cross-currency
-- rollups (forecasting, pipeline totals). Rates are tenant-managed in
-- Settings → Company → Exchange rates.

CREATE TABLE IF NOT EXISTS exchange_rates (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  currency    TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate        NUMERIC(18, 8) NOT NULL CHECK (rate > 0),
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, currency)
);
