-- Migration 012: pgvector extension + embedding columns
--
-- Adds the pgvector extension for semantic similarity search and RAG context
-- retrieval in the AI Engine. Embeddings (1536-dim, voyage-3 compatible) are
-- stored on the graph entity tables alongside their AGE node IDs.
--
-- The apache/age:release_PG16_1.6.0 Docker image used in this project ships
-- pgvector; in production (CloudSQL/RDS) enable the extension manually first.

-- ── Extension ─────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Embeddings table (tenant-scoped, entity-generic) ─────────────────────────
-- Keeps embeddings out of the entity tables themselves so that:
--   a) the graph-core AGE queries aren't slowed by large VECTOR columns
--   b) embeddings can be re-generated without touching entity rows
--   c) a single index covers all entity types
CREATE TABLE IF NOT EXISTS entity_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,                        -- 'contact' | 'company' | 'deal' | 'activity'
  entity_id   UUID NOT NULL,
  model       TEXT NOT NULL DEFAULT 'voyage-3',     -- embedding model used
  embedding   VECTOR(1536) NOT NULL,
  input_text  TEXT,                                  -- the text that was embedded (for audit/regen)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, entity_type, entity_id, model)
);

-- HNSW index for approximate nearest-neighbour search (cosine distance)
-- ef_construction=64, m=16 are good starting values for <1M vectors
CREATE INDEX IF NOT EXISTS idx_entity_embeddings_hnsw
  ON entity_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_entity_embeddings_tenant_type
  ON entity_embeddings (tenant_id, entity_type);

-- ── Review queue embeddings ───────────────────────────────────────────────────
-- Stores embeddings for review queue items so similar past decisions can be
-- surfaced to the rep during manual review (RAG-style context).
ALTER TABLE review_queue
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

CREATE INDEX IF NOT EXISTS idx_review_queue_embedding
  ON review_queue
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- ── Helper: update embedding updated_at on upsert ────────────────────────────
CREATE OR REPLACE FUNCTION set_embedding_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entity_embeddings_updated_at
  BEFORE UPDATE ON entity_embeddings
  FOR EACH ROW EXECUTE FUNCTION set_embedding_updated_at();
