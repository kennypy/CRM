-- Migration 012: pgvector extension + embedding columns
--
-- Adds the pgvector extension for semantic similarity search and RAG context
-- retrieval in the AI Engine. Embeddings (1536-dim, voyage-3 compatible) are
-- stored on the graph entity tables alongside their AGE node IDs.
--
-- pgvector is OPTIONAL: not every Postgres image ships it (the apache/age image
-- used for local/pilot does not). This migration therefore guards the whole
-- embedding schema behind an availability check — it is created in full when
-- pgvector is present (prod: CloudSQL/RDS/self-hosted with the extension), and
-- cleanly skipped otherwise. Semantic search is scaffold-only today, so skipping
-- has no runtime impact.

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE NOTICE 'pgvector not available — skipping embedding schema (012)';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS vector;

  -- Vector-typed DDL is run via EXECUTE so it is only parsed when the extension
  -- is present (the VECTOR type / hnsw operators do not exist otherwise).
  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS entity_embeddings (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id   UUID NOT NULL,
      model       TEXT NOT NULL DEFAULT 'voyage-3',
      embedding   VECTOR(1536) NOT NULL,
      input_text  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, entity_type, entity_id, model)
    )
  $ddl$;

  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_entity_embeddings_hnsw
      ON entity_embeddings USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  $ddl$;

  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_entity_embeddings_tenant_type
      ON entity_embeddings (tenant_id, entity_type)
  $ddl$;

  EXECUTE $ddl$
    ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS embedding VECTOR(1536)
  $ddl$;

  EXECUTE $ddl$
    CREATE INDEX IF NOT EXISTS idx_review_queue_embedding
      ON review_queue USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
      WHERE embedding IS NOT NULL
  $ddl$;

  CREATE OR REPLACE FUNCTION set_embedding_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $fn$;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_entity_embeddings_updated_at') THEN
    EXECUTE $ddl$
      CREATE TRIGGER trg_entity_embeddings_updated_at
        BEFORE UPDATE ON entity_embeddings
        FOR EACH ROW EXECUTE FUNCTION set_embedding_updated_at()
    $ddl$;
  END IF;
END
$mig$;
