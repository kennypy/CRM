/**
 * Knowledge Base — internal management routes (authenticated).
 *
 * Article authoring + categories for the tenant's knowledge base. Published
 * articles are served to the public customer portal via routes/portal.ts.
 *
 * Categories:
 *   GET    /api/v1/kb/categories        — list with article counts
 *   POST   /api/v1/kb/categories        — create (manager+)
 *   PATCH  /api/v1/kb/categories/:id    — update (manager+)
 *   DELETE /api/v1/kb/categories/:id    — delete (manager+)
 * Articles:
 *   GET    /api/v1/kb                    — list (filter: status, categoryId, search)
 *   GET    /api/v1/kb/:id                — single article
 *   POST   /api/v1/kb                    — create (manager+)
 *   PATCH  /api/v1/kb/:id                — update / publish (manager+)
 *   DELETE /api/v1/kb/:id                — delete (manager+)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, readPool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";

/** URL-safe slug from a title; collisions are resolved by the caller. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

/** Ensure the slug is unique for this tenant on the given table, suffixing -2, -3… */
async function uniqueSlug(table: "kb_articles" | "kb_categories", tenantId: string, base: string, excludeId?: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const { rows } = await pool.query(
      `SELECT 1 FROM ${table} WHERE tenant_id = $1 AND slug = $2 ${excludeId ? "AND id <> $3" : ""} LIMIT 1`,
      excludeId ? [tenantId, slug, excludeId] : [tenantId, slug]
    );
    if (!rows.length) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

const CategorySchema = z.object({
  name:        z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  sortOrder:   z.number().int().optional(),
});

const ArticleSchema = z.object({
  title:      z.string().min(1).max(200),
  excerpt:    z.string().max(500).optional().nullable(),
  body:       z.string().max(100_000).optional().default(""),
  categoryId: z.string().uuid().optional().nullable(),
  status:     z.enum(["draft", "published"]).optional(),
});

const ArticleUpdateSchema = ArticleSchema.partial();

function toCategory(r: Record<string, unknown>) {
  return {
    id: r.id, name: r.name, slug: r.slug, description: r.description ?? null,
    sortOrder: r.sort_order ?? 0, articleCount: Number(r.article_count ?? 0),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toArticle(r: Record<string, unknown>) {
  return {
    id: r.id, title: r.title, slug: r.slug, excerpt: r.excerpt ?? null,
    body: r.body ?? "", status: r.status, viewCount: Number(r.view_count ?? 0),
    categoryId: r.category_id ?? null, categoryName: r.category_name ?? null,
    authorId: r.author_id ?? null, publishedAt: r.published_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function kbRoutes(server: FastifyInstance) {
  // ── Categories ───────────────────────────────────────────────────────────
  server.get("/categories", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await readPool.query(
      `SELECT c.*, COUNT(a.id)::int AS article_count
       FROM kb_categories c
       LEFT JOIN kb_articles a ON a.category_id = c.id
       WHERE c.tenant_id = $1
       GROUP BY c.id
       ORDER BY c.sort_order, c.name`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows.map(toCategory) });
  });

  server.post("/categories", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const parsed = CategorySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId } = request.user;
    const slug = await uniqueSlug("kb_categories", tenantId, slugify(parsed.data.name));
    const { rows } = await pool.query(
      `INSERT INTO kb_categories (tenant_id, name, slug, description, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, parsed.data.name, slug, parsed.data.description ?? null, parsed.data.sortOrder ?? 0]
    );
    return reply.status(201).send({ success: true, data: toCategory({ ...rows[0], article_count: 0 }) });
  });

  server.patch("/categories/:id", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = CategorySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId } = request.user;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (parsed.data.name !== undefined) { vals.push(parsed.data.name); sets.push(`name = $${vals.length}`); }
    if (parsed.data.description !== undefined) { vals.push(parsed.data.description); sets.push(`description = $${vals.length}`); }
    if (parsed.data.sortOrder !== undefined) { vals.push(parsed.data.sortOrder); sets.push(`sort_order = $${vals.length}`); }
    if (!sets.length) return reply.status(400).send({ success: false, error: { code: "NO_FIELDS" } });
    vals.push(id, tenantId);
    const { rows } = await pool.query(
      `UPDATE kb_categories SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toCategory(rows[0]) });
  });

  server.delete("/categories/:id", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rowCount } = await pool.query(`DELETE FROM kb_categories WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true });
  });

  // ── Articles ─────────────────────────────────────────────────────────────
  server.get("/", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const conditions = ["a.tenant_id = $1"];
    const vals: unknown[] = [tenantId];
    if (q.status && ["draft", "published"].includes(q.status)) { vals.push(q.status); conditions.push(`a.status = $${vals.length}`); }
    if (q.categoryId) { vals.push(q.categoryId); conditions.push(`a.category_id = $${vals.length}`); }
    if (q.search) { vals.push(`%${q.search.toLowerCase()}%`); conditions.push(`(lower(a.title) LIKE $${vals.length} OR lower(a.excerpt) LIKE $${vals.length})`); }
    const { rows } = await readPool.query(
      `SELECT a.*, c.name AS category_name
       FROM kb_articles a LEFT JOIN kb_categories c ON c.id = a.category_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY a.updated_at DESC`,
      vals
    );
    return reply.send({ success: true, data: rows.map(toArticle) });
  });

  server.get("/:id", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows } = await readPool.query(
      `SELECT a.*, c.name AS category_name
       FROM kb_articles a LEFT JOIN kb_categories c ON c.id = a.category_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [id, tenantId]
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toArticle(rows[0]) });
  });

  server.post("/", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const parsed = ArticleSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId, sub: userId } = request.user;
    const d = parsed.data;
    const slug = await uniqueSlug("kb_articles", tenantId, slugify(d.title));
    const published = d.status === "published";
    const { rows } = await pool.query(
      `INSERT INTO kb_articles (tenant_id, category_id, slug, title, excerpt, body, status, author_id, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${published ? "NOW()" : "NULL"})
       RETURNING *`,
      [tenantId, d.categoryId ?? null, slug, d.title, d.excerpt ?? null, d.body ?? "", d.status ?? "draft", userId]
    );
    return reply.status(201).send({ success: true, data: toArticle(rows[0]) });
  });

  server.patch("/:id", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ArticleUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId } = request.user;
    const d = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [];
    if (d.title !== undefined)      { vals.push(d.title);          sets.push(`title = $${vals.length}`); }
    if (d.excerpt !== undefined)    { vals.push(d.excerpt);        sets.push(`excerpt = $${vals.length}`); }
    if (d.body !== undefined)       { vals.push(d.body);           sets.push(`body = $${vals.length}`); }
    if (d.categoryId !== undefined) { vals.push(d.categoryId);     sets.push(`category_id = $${vals.length}`); }
    if (d.status !== undefined) {
      vals.push(d.status);
      sets.push(`status = $${vals.length}`);
      // Stamp published_at the first time it goes live; clear it when unpublished.
      sets.push(d.status === "published" ? `published_at = COALESCE(published_at, NOW())` : `published_at = NULL`);
    }
    if (!sets.length) return reply.status(400).send({ success: false, error: { code: "NO_FIELDS" } });
    vals.push(id, tenantId);

    const { rows } = await pool.query(
      `UPDATE kb_articles SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toArticle(rows[0]) });
  });

  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rowCount } = await pool.query(`DELETE FROM kb_articles WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true });
  });
}
