-- 029: CCPA compliance columns for contacts
--
-- Contacts are AGE graph nodes in this model, not a relational table, so the
-- CCPA flags live as node properties (do_not_sell / ccpa_opt_out_at set via
-- graph-core). This migration only applies the relational columns when a
-- relational `contacts` table actually exists (e.g. a future projection/cache
-- table), and is otherwise a safe no-op.

DO $$
BEGIN
  IF to_regclass('public.contacts') IS NOT NULL THEN
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS do_not_sell     BOOLEAN DEFAULT FALSE;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ccpa_opt_out_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_contacts_do_not_sell
      ON contacts (tenant_id) WHERE do_not_sell = TRUE;
  ELSE
    RAISE NOTICE 'contacts is a graph node (no relational table) — CCPA columns skipped (029)';
  END IF;
END $$;
