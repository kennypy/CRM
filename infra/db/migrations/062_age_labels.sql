-- Migration 062: pre-create Apache AGE labels.
--
-- AGE creates a label's backing table lazily on the first CREATE/MERGE that
-- uses it, which requires ownership of the graph's base label tables. In
-- production the services connect as the least-privilege `nexcrm_service`
-- role (migration 042), so on a fresh install the very first contact create
-- failed with "must be owner of table _ag_label_vertex". Creating every label
-- the code uses here — as the migration (owner) role — fixes that.
-- Idempotent; a no-op when AGE or the graph is absent.

DO $$
DECLARE
  v text;
  e text;
  gid oid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') THEN
    RAISE NOTICE 'AGE not installed — skipping label bootstrap';
    RETURN;
  END IF;
  SELECT graphid INTO gid FROM ag_catalog.ag_graph WHERE name = 'nexcrm_graph';
  IF gid IS NULL THEN
    RAISE NOTICE 'nexcrm_graph missing — skipping label bootstrap';
    RETURN;
  END IF;

  FOREACH v IN ARRAY ARRAY['Person', 'Company', 'Deal', 'Activity'] LOOP
    IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = gid AND name = v) THEN
      -- Label passed as a literal: the argument type differs between AGE releases
      -- (name in 1.5, cstring in 1.6), and a text variable matches neither on 1.6,
      -- which made this migration fail on every fresh 1.6 database.
      EXECUTE format('SELECT ag_catalog.create_vlabel(%L, %L)', 'nexcrm_graph', v);
    END IF;
  END LOOP;

  FOREACH e IN ARRAY ARRAY['WORKS_AT', 'INVOLVED_IN', 'INFLUENCES', 'RELATED_TO', 'PARTICIPATED_IN'] LOOP
    IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = gid AND name = e) THEN
      EXECUTE format('SELECT ag_catalog.create_elabel(%L, %L)', 'nexcrm_graph', e);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_service') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA nexcrm_graph TO nexcrm_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nexcrm_graph TO nexcrm_service';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA nexcrm_graph TO nexcrm_service';
  END IF;
END $$;
