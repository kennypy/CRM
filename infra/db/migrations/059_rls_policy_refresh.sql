-- Migration 059: RLS policy refresh.
--
-- Migration 043 enabled RLS + tenant_isolation policies on every public table
-- carrying a tenant_id column — but only for tables that existed at that
-- point. This re-runs the same idempotent loop so tables created since
-- (export_jobs, nav_tab_groups, user_nav_tabs, and the Phase-3 feature tables
-- in migrations 050-058) get the same protection.
--
-- Deliberately numbered after every feature migration in this series; safe to
-- re-run any time a new tenant-scoped table is added (DROP POLICY IF EXISTS
-- makes it idempotent).

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_app') THEN
    RAISE NOTICE 'nexcrm_app role missing (042 not applied?) — skipping RLS refresh';
    RETURN;
  END IF;

  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')          -- ordinary tables + partitioned parents
      AND c.relispartition = false          -- skip partition children
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    -- Compare as text so the policy works whether tenant_id is uuid or text.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO nexcrm_app '
      || 'USING (tenant_id::text = current_setting(''app.current_tenant'', true)) '
      || 'WITH CHECK (tenant_id::text = current_setting(''app.current_tenant'', true))',
      t);
  END LOOP;
END $$;
