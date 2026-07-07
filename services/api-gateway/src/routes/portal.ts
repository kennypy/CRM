/**
 * Customer Portal — PUBLIC (unauthenticated) knowledge-base routes.
 *
 * Registered as a plugin BEFORE the gateway's authMiddleware hook, so these are
 * reachable without a JWT. The tenant is resolved from its public `slug` in the
 * URL (tenants.slug is NOT NULL UNIQUE) — never from a token. Only PUBLISHED
 * articles are ever exposed, and only for the resolved tenant.
 *
 * GET /portal/:slug                        — portal home: tenant name + categories + published articles
 * GET /portal/:slug/articles/:articleSlug  — one published article (increments view_count)
 * GET /portal/:slug/search?q=              — search published articles
 */

import type { FastifyInstance } from "fastify";
import { pool, readPool } from "../db";

async function resolveTenant(slug: string): Promise<{ id: string; name: string } | null> {
  const { rows } = await readPool.query(
    `SELECT id, name FROM tenants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

function toPublicArticle(r: Record<string, unknown>, includeBody = false) {
  const base: Record<string, unknown> = {
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt ?? null,
    categoryId: r.category_id ?? null,
    categoryName: r.category_name ?? null,
    updatedAt: r.updated_at,
    publishedAt: r.published_at ?? null,
  };
  if (includeBody) { base.body = r.body ?? ""; base.viewCount = Number(r.view_count ?? 0); }
  return base;
}

export async function portalRoutes(server: FastifyInstance) {
  // ── GET /portal/:slug — portal home ──────────────────────────────────────
  server.get("/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const tenant = await resolveTenant(slug);
    if (!tenant) return reply.status(404).send({ success: false, error: { code: "PORTAL_NOT_FOUND" } });

    const [cats, articles] = await Promise.all([
      readPool.query(
        `SELECT c.id, c.name, c.slug, c.description,
                COUNT(a.id) FILTER (WHERE a.status = 'published')::int AS article_count
         FROM kb_categories c
         LEFT JOIN kb_articles a ON a.category_id = c.id
         WHERE c.tenant_id = $1
         GROUP BY c.id
         HAVING COUNT(a.id) FILTER (WHERE a.status = 'published') > 0
         ORDER BY c.sort_order, c.name`,
        [tenant.id]
      ),
      readPool.query(
        `SELECT a.slug, a.title, a.excerpt, a.category_id, a.updated_at, a.published_at, c.name AS category_name
         FROM kb_articles a LEFT JOIN kb_categories c ON c.id = a.category_id
         WHERE a.tenant_id = $1 AND a.status = 'published'
         ORDER BY a.published_at DESC NULLS LAST, a.updated_at DESC
         LIMIT 200`,
        [tenant.id]
      ),
    ]);

    return reply.send({
      success: true,
      data: {
        tenant: { name: tenant.name, slug },
        categories: cats.rows.map((r) => ({
          id: r.id, name: r.name, slug: r.slug, description: r.description ?? null, articleCount: Number(r.article_count ?? 0),
        })),
        articles: articles.rows.map((r) => toPublicArticle(r)),
      },
    });
  });

  // ── GET /portal/:slug/articles/:articleSlug ──────────────────────────────
  server.get("/:slug/articles/:articleSlug", async (request, reply) => {
    const { slug, articleSlug } = request.params as { slug: string; articleSlug: string };
    const tenant = await resolveTenant(slug);
    if (!tenant) return reply.status(404).send({ success: false, error: { code: "PORTAL_NOT_FOUND" } });

    const { rows } = await readPool.query(
      `SELECT a.*, c.name AS category_name
       FROM kb_articles a LEFT JOIN kb_categories c ON c.id = a.category_id
       WHERE a.tenant_id = $1 AND a.slug = $2 AND a.status = 'published'`,
      [tenant.id, articleSlug]
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "ARTICLE_NOT_FOUND" } });

    // Best-effort view counter — never block the read on it.
    pool.query(`UPDATE kb_articles SET view_count = view_count + 1 WHERE id = $1`, [rows[0].id]).catch(() => { /* ignore */ });

    return reply.send({ success: true, data: { tenant: { name: tenant.name, slug }, article: toPublicArticle(rows[0], true) } });
  });

  // ── GET /portal/:slug/search?q= ──────────────────────────────────────────
  server.get("/:slug/search", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const q = (request.query as Record<string, string>).q ?? "";
    const term = q.trim();
    const tenant = await resolveTenant(slug);
    if (!tenant) return reply.status(404).send({ success: false, error: { code: "PORTAL_NOT_FOUND" } });
    if (term.length < 2) return reply.send({ success: true, data: { results: [] } });

    const { rows } = await readPool.query(
      `SELECT a.slug, a.title, a.excerpt, a.category_id, a.updated_at, a.published_at, c.name AS category_name
       FROM kb_articles a LEFT JOIN kb_categories c ON c.id = a.category_id
       WHERE a.tenant_id = $1 AND a.status = 'published'
         AND (lower(a.title) LIKE $2 OR lower(a.excerpt) LIKE $2 OR lower(a.body) LIKE $2)
       ORDER BY a.published_at DESC NULLS LAST
       LIMIT 30`,
      [tenant.id, `%${term.toLowerCase()}%`]
    );
    return reply.send({ success: true, data: { results: rows.map((r) => toPublicArticle(r)) } });
  });
}
