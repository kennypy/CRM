-- Migration 049: Custom roles & permissions builder.
--
-- user_profiles (the tenant-editable role presets from migration 040) gain a
-- per-module permission grid:
--
--   permissions: { "<module>": "none" | "read" | "write" }
--
-- Modules: contacts, companies, deals, activities, tasks, quotes, reports,
-- sequences, campaigns, workflows (catalog lives in
-- services/api-gateway/src/middleware/module-access.ts).
--
-- Absent module keys mean "no restriction" — the user's base-role RBAC is the
-- only gate, which keeps every existing profile behaving exactly as before.
-- Enforcement happens in the api-gateway via requireModuleAccess preHandlers.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
