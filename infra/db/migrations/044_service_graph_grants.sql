-- 044_service_graph_grants.sql
-- Workstream 1 (least privilege): let nexcrm_service write to the Apache AGE
-- graph so the internal graph-writing services (graph-core, ingestion, ai-engine)
-- can run as a non-superuser instead of the bootstrap superuser `nexcrm`.
--
-- Reading the graph only needs USAGE + SELECT (042). Writing (CREATE/MERGE nodes
-- and edges) additionally needs CREATE on the graph schema, DML on its label
-- tables + sequences, and DML on ag_catalog (AGE writes label metadata there).
-- `age` is in shared_preload_libraries, so no per-session LOAD is required — the
-- cypher helper's LOAD is made best-effort so a non-superuser (which may not LOAD
-- libraries) still works.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'nexcrm_graph') THEN
    EXECUTE 'GRANT USAGE, CREATE ON SCHEMA nexcrm_graph TO nexcrm_service';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA nexcrm_graph TO nexcrm_service';
    EXECUTE 'GRANT ALL ON ALL SEQUENCES IN SCHEMA nexcrm_graph TO nexcrm_service';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA nexcrm_graph GRANT ALL ON TABLES TO nexcrm_service';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA nexcrm_graph GRANT ALL ON SEQUENCES TO nexcrm_service';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ag_catalog') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ag_catalog TO nexcrm_service';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ag_catalog TO nexcrm_service';
  END IF;
END $$;

COMMIT;
