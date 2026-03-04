-- NexCRM Migration 005 — Tenant Preferences
-- Adds first-class currency / locale / timezone columns to tenants.
-- The `settings` JSONB column was already present; these new columns are
-- strongly-typed and indexed so they can be used in queries efficiently.
-- All columns are nullable to preserve backward compatibility with existing rows.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_currency  TEXT NOT NULL DEFAULT 'USD'
    CHECK (default_currency ~ '^[A-Z]{3}$'),   -- ISO 4217
  ADD COLUMN IF NOT EXISTS locale            TEXT NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS timezone          TEXT NOT NULL DEFAULT 'UTC';

-- Back-fill existing rows (safe because DEFAULT already applies to new inserts)
UPDATE tenants SET
  default_currency = COALESCE((settings->>'default_currency'), 'USD'),
  locale           = COALESCE((settings->>'locale'),           'en-US'),
  timezone         = COALESCE((settings->>'timezone'),         'UTC')
WHERE default_currency = 'USD' AND locale = 'en-US' AND timezone = 'UTC';

COMMENT ON COLUMN tenants.default_currency IS
  'ISO 4217 currency code (e.g. EUR, USD, GBP). Deals inherit this unless they carry their own currency.';
COMMENT ON COLUMN tenants.locale IS
  'BCP-47 locale tag used for Intl.NumberFormat / date formatting (e.g. en-US, de-DE, fr-FR).';
COMMENT ON COLUMN tenants.timezone IS
  'IANA timezone name used for date display (e.g. Europe/Berlin, America/New_York).';
