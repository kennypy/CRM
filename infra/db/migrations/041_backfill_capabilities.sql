-- 041_backfill_capabilities.sql
-- Backfill per-user capabilities so enforcing them (import/export/campaigns via
-- requireCapability) does not retroactively lock out existing users.
--
-- Before this, data import/export and campaign creation were open to every rep
-- (only coarse RBAC + CRM scope gated them). Now those endpoints additionally
-- require the matching capability. Grant the previously-ungated capabilities to
-- all existing users to preserve their current access; admins manage them
-- per-user going forward. Admins/managers hold all capabilities implicitly, so
-- this mainly matters for reps and read-only users.
--
-- Also mirror the legacy can_quote column into the capabilities bag so the
-- quoting flow and the capability model agree.

BEGIN;

UPDATE users
SET capabilities = COALESCE(capabilities, '{}'::jsonb)
     || '{"can_import": true, "can_export": true, "can_campaigns": true}'::jsonb
     || jsonb_build_object('can_quote', COALESCE(can_quote, false));

COMMIT;
