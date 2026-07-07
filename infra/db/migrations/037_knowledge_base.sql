-- 037_knowledge_base.sql
-- Knowledge Base + Customer Portal.
--
-- Tenant-scoped KB articles grouped into categories. Articles have a draft →
-- published lifecycle; only published articles are exposed on the public
-- customer portal (resolved by tenant slug — see routes/portal.ts). Follows the
-- standard tenant_id-scoped pattern (unlike the global support-tickets queue).

BEGIN;

CREATE TABLE IF NOT EXISTS kb_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_kb_categories_tenant ON kb_categories(tenant_id, sort_order);

CREATE TRIGGER kb_categories_updated_at BEFORE UPDATE ON kb_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS kb_articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES kb_categories(id) ON DELETE SET NULL,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  excerpt       TEXT,
  body          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  view_count    INTEGER NOT NULL DEFAULT 0,
  author_id     UUID REFERENCES users(id),
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_tenant       ON kb_articles(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_articles_category     ON kb_articles(category_id);
-- Trigram-friendly lower(title) index for portal search; falls back to a plain
-- b-tree if pg_trgm isn't installed (search uses ILIKE either way).
CREATE INDEX IF NOT EXISTS idx_kb_articles_title_lower  ON kb_articles(tenant_id, lower(title));

CREATE TRIGGER kb_articles_updated_at BEFORE UPDATE ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
