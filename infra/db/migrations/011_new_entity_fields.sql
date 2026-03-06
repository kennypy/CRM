-- Migration 011: Extended fields for users, activities, and quotes
--
-- Adds new columns to support richer entity profiles and creator/relation tracking.
-- Graph entities (companies, contacts, deals) are schema-free AGE nodes — new
-- properties are stored directly on those nodes without a SQL migration.

-- ── Users: extended profile fields ───────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country        TEXT,
  ADD COLUMN IF NOT EXISTS timezone       TEXT,
  ADD COLUMN IF NOT EXISTS language       TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS phone          TEXT,
  ADD COLUMN IF NOT EXISTS twilio_number  TEXT;

-- ── Activities: creator tracking + related entity reference ──────────────────
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_to   TEXT;   -- free-text reference (e.g. contact name, company name)

CREATE INDEX IF NOT EXISTS idx_activities_created_by
  ON activities (created_by)
  WHERE created_by IS NOT NULL AND deleted_at IS NULL;

-- ── Quotes: related entity reference ─────────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS related_to   TEXT;   -- e.g. deal name or opportunity name
