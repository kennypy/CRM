-- Migration 064: sales lifecycle support.
--
-- Lead → existing-contact conversion: the lead node is merged into the contact,
-- so the conversion row keeps the lead's id (funnel reporting) and records the
-- contact it became.
ALTER TABLE lead_conversions ADD COLUMN IF NOT EXISTS merged_into_contact_id UUID;
CREATE INDEX IF NOT EXISTS idx_lead_conversions_merged
  ON lead_conversions (tenant_id, merged_into_contact_id) WHERE merged_into_contact_id IS NOT NULL;
