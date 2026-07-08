-- 042_rls_roles.sql
-- Workstream 1 (tenant isolation): dedicated DB roles.
--
-- Today every service connects as the bootstrap superuser `nexcrm`, which OWNS
-- every table and therefore bypasses Row-Level Security. To enforce RLS we
-- introduce non-owner roles:
--
--   nexcrm_app      RLS-subject. Used by the user-facing api-gateway request
--                   path. Each request sets `app.current_tenant` via SET LOCAL,
--                   and RLS policies (043) constrain every read/write to it.
--   nexcrm_platform RLS-subject, but granted metadata tables with USING(true)
--                   policies so the provider console can list workspaces/admins/
--                   billing across tenants — WITHOUT any grant on CRM content.
--   nexcrm_service  BYPASSRLS. Internal services + workers (auth/login,
--                   graph-core, outreach, ai-engine, ingestion, background
--                   jobs, merges, registration) that are cross-tenant by nature
--                   and always pass tenant_id explicitly.
--
-- `nexcrm` (owner/superuser) stays for migrations & seeders only.
--
-- NOTE: role passwords default to the pilot dev password here so the stack keeps
-- working out-of-the-box; production deploys MUST override them:
--   ALTER ROLE nexcrm_app      PASSWORD '<secret>';
--   ALTER ROLE nexcrm_platform PASSWORD '<secret>';
--   ALTER ROLE nexcrm_service  PASSWORD '<secret>';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_app') THEN
    CREATE ROLE nexcrm_app LOGIN PASSWORD 'nexcrm_dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_platform') THEN
    CREATE ROLE nexcrm_platform LOGIN PASSWORD 'nexcrm_dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_service') THEN
    CREATE ROLE nexcrm_service LOGIN PASSWORD 'nexcrm_dev' BYPASSRLS;
  ELSE
    ALTER ROLE nexcrm_service BYPASSRLS;
  END IF;
END $$;

-- ── Schema usage ────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO nexcrm_app, nexcrm_platform, nexcrm_service;

-- ── nexcrm_app: full DML on all current + future public tables/sequences ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexcrm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexcrm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexcrm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nexcrm_app;

-- ── nexcrm_service: full DML + graph access (graph-core, workers, auth) ──────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexcrm_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexcrm_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexcrm_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nexcrm_service;

-- Apache AGE graph access (graph-core connects as nexcrm_service).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ag_catalog') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA ag_catalog TO nexcrm_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ag_catalog TO nexcrm_service';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA ag_catalog GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexcrm_service';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'nexcrm_graph') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA nexcrm_graph TO nexcrm_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nexcrm_graph TO nexcrm_service';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA nexcrm_graph GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexcrm_service';
  END IF;
END $$;

-- ── nexcrm_platform: metadata SELECT only (provider console) ─────────────────
-- No grant on CRM content or the graph → the platform owner can never read
-- workspace business data. Cross-tenant visibility on these is enabled by
-- USING(true) policies in 043 (RLS is otherwise deny-by-default).
GRANT SELECT ON tenants, users, feature_usage_log, workspace_usage_stats, outreach_usage TO nexcrm_platform;

COMMIT;
