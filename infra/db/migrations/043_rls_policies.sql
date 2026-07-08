-- 043_rls_policies.sql
-- Workstream 1: enable Row-Level Security so tenant isolation is enforced by the
-- database, not just by app-level `WHERE tenant_id`.
--
-- Model:
--   • nexcrm_app (api-gateway request path) is RLS-subject. Each request sets
--     app.current_tenant (SET LOCAL); the tenant_isolation policy constrains
--     every read/write to that tenant. No context → current_setting returns
--     NULL → the predicate is false → deny-by-default (fail closed).
--   • nexcrm_platform gets USING(true) on a few metadata tables so the provider
--     console can list workspaces/admins/billing across tenants (it has no
--     grant on CRM content tables, so it still can't read business data).
--   • nexcrm_service and nexcrm (owner) have BYPASSRLS / ownership, so internal
--     services, workers, and migrations are unaffected.
--
-- Deferred (tracked separately): auth token tables (refresh_tokens,
-- password_reset_tokens) are accessed only by the owner-role auth service and
-- are keyed by token hash, so they are left out.

BEGIN;

-- ── Core: every base table (ordinary or partitioned parent) that carries a
-- tenant_id gets RLS + a tenant_isolation policy for nexcrm_app. Partition
-- children are skipped (relispartition) — the parent policy is enforced for
-- access through the parent, which is how the app always queries them.
DO $$
DECLARE t text;
BEGIN
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
    -- Compare as text so the policy works whether tenant_id is uuid or text
    -- (activities.tenant_id is text; most others are uuid). The app's own
    -- WHERE tenant_id = $1 still drives index use; RLS is the safety net.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO nexcrm_app '
      || 'USING (tenant_id::text = current_setting(''app.current_tenant'', true)) '
      || 'WITH CHECK (tenant_id::text = current_setting(''app.current_tenant'', true))',
      t);
  END LOOP;
END $$;

-- ── Provider metadata: let nexcrm_platform read across tenants on the tables the
-- provider console needs (permissive policies are OR-combined per role).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','users','feature_usage_log','workspace_usage_stats','outreach_usage']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS platform_read_all ON public.%I', t);
    EXECUTE format('CREATE POLICY platform_read_all ON public.%I FOR SELECT TO nexcrm_platform USING (true)', t);
  END LOOP;
END $$;

-- ── tenants (no tenant_id of its own): a tenant user may see only its own row.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON public.tenants;
CREATE POLICY tenant_self ON public.tenants FOR ALL TO nexcrm_app
  USING (id::text = current_setting('app.current_tenant', true))
  WITH CHECK (id::text = current_setting('app.current_tenant', true));

-- ── Child tables (no tenant_id): scope via their tenant-bearing parent. ───────
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.quote_items;
CREATE POLICY tenant_isolation ON public.quote_items FOR ALL TO nexcrm_app
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
                 AND q.tenant_id::text = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
                 AND q.tenant_id::text = current_setting('app.current_tenant', true)));

ALTER TABLE public.entity_list_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.entity_list_members;
CREATE POLICY tenant_isolation ON public.entity_list_members FOR ALL TO nexcrm_app
  USING (EXISTS (SELECT 1 FROM public.entity_lists l WHERE l.id = entity_list_members.list_id
                 AND l.tenant_id::text = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.entity_lists l WHERE l.id = entity_list_members.list_id
                 AND l.tenant_id::text = current_setting('app.current_tenant', true)));

-- activity_participants is partitioned; scope via the activities parent by id.
ALTER TABLE public.activity_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.activity_participants;
CREATE POLICY tenant_isolation ON public.activity_participants FOR ALL TO nexcrm_app
  USING (EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_participants.activity_id
                 AND a.tenant_id::text = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_participants.activity_id
                 AND a.tenant_id::text = current_setting('app.current_tenant', true)));

COMMIT;
