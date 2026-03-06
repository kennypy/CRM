-- Migration 009: add denormalised company_name / contact_name to quotes
-- Companies and contacts live in the AGE graph (not SQL tables), so we
-- can't use a JOIN. Store the display name at write-time instead.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT;
