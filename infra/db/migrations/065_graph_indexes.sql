-- Migration 065: indexes on the Apache AGE graph tables.
--
-- AGE creates label tables with NO indexes — not even on the vertex id — and
-- none were ever added. Every lookup of a contact, account or opportunity was
-- a sequential scan of that label's table across ALL tenants, and every
-- relationship traversal a hash join over the whole edge table. Invisible with
-- a few hundred records; at one 120-seat org's volume (100k contacts, 50k
-- opportunities, 1M activities) single requests took 0.5–9 s with no one else
-- on the system (scripts/load-test).
--
-- What the planner needs, given how AGE compiles Cypher:
--   MATCH (n:Label {id: $id, tenant_id: $t})   → properties @> '{...}'   → GIN
--   WHERE n.owner_id IN $ids / n.id IN $ids    → agtype_access_operator  → btree
--   (a)-[:REL]->(b)                            → joins on start_id/end_id/id
--
-- Not CONCURRENTLY (migrations run in a transaction): on an existing large
-- database, apply during a maintenance window.
-- Idempotent; a no-op when AGE or the graph is absent.

DO $$
DECLARE
  v text;
  e text;
  k text;
  gid oid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') THEN
    RAISE NOTICE 'AGE not installed — skipping graph indexes';
    RETURN;
  END IF;
  SELECT graphid INTO gid FROM ag_catalog.ag_graph WHERE name = 'nexcrm_graph';
  IF gid IS NULL THEN
    RAISE NOTICE 'nexcrm_graph missing — skipping graph indexes';
    RETURN;
  END IF;

  FOREACH v IN ARRAY ARRAY['Person', 'Company', 'Deal', 'Activity'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = gid AND name = v);
    -- vertex id: every edge join lands here
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON nexcrm_graph.%I (id)', 'idx_g_' || lower(v) || '_gid', v);
    -- {id: ..., tenant_id: ...} property-map matches
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON nexcrm_graph.%I USING gin (properties)', 'idx_g_' || lower(v) || '_props', v);
    -- WHERE n.id IN [...] / n.id = ...
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON nexcrm_graph.%I (ag_catalog.agtype_access_operator(VARIADIC ARRAY[properties, %L::ag_catalog.agtype]))',
      'idx_g_' || lower(v) || '_id', v, '"id"');
  END LOOP;

  -- Sharing filters: WHERE n.owner_id IN [visible owners]
  FOREACH v IN ARRAY ARRAY['Person', 'Company', 'Deal'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = gid AND name = v);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON nexcrm_graph.%I (ag_catalog.agtype_access_operator(VARIADIC ARRAY[properties, %L::ag_catalog.agtype]))',
      'idx_g_' || lower(v) || '_owner', v, '"owner_id"');
  END LOOP;

  FOREACH e IN ARRAY ARRAY['WORKS_AT', 'INVOLVED_IN', 'INFLUENCES', 'RELATED_TO', 'PARTICIPATED_IN'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = gid AND name = e);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON nexcrm_graph.%I (start_id)', 'idx_g_' || lower(e) || '_start', e);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON nexcrm_graph.%I (end_id)', 'idx_g_' || lower(e) || '_end', e);
  END LOOP;

  FOREACH k IN ARRAY ARRAY['Person', 'Company', 'Deal', 'Activity', 'WORKS_AT', 'INVOLVED_IN', 'INFLUENCES', 'RELATED_TO', 'PARTICIPATED_IN'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM ag_catalog.ag_label WHERE graph = gid AND name = k);
    EXECUTE format('ANALYZE nexcrm_graph.%I', k);
  END LOOP;
END $$;
