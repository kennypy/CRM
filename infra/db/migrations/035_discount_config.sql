-- 035_discount_config.sql
-- Persist the discount-approval configuration edited in Settings → Quoting.
-- Previously the UI collected per-role thresholds and a TCV approver matrix,
-- but the tenant PATCH schema accepted only currency/locale/timezone, so the
-- rules were silently dropped and approval always fell back to the flat
-- discount_approval_threshold column. This JSONB column holds the full config
-- (roleThresholds, tcvTiers, and the flat threshold mirror) so it round-trips
-- and can drive role-aware approval routing.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS discount_config JSONB NOT NULL DEFAULT '{}'::jsonb;
