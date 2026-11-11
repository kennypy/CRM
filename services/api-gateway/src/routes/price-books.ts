/**
 * Price books (/api/v1/price-books)
 *
 * A price book holds per-currency list prices for catalog products. Quotes
 * can reference a price book; line items for products in that book are then
 * priced from it (see quotes.ts), and discounts are measured against it.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";
import { requireCrmRead } from "../middleware/scope";
import { moduleAccessGate } from "../middleware/module-access";

const BookSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  currency:    z.string().regex(/^[A-Z]{3}$/).default("USD"),
  isStandard:  z.boolean().default(false),
  active:      z.boolean().default(true),
});
const EntriesSchema = z.object({
  entries: z.array(z.object({
    productId: z.string().uuid(),
    unitPrice: z.number().min(0).max(1_000_000_000),
    active:    z.boolean().default(true),
  })).max(5000),
});
const IdParam = z.object({ id: z.string().uuid() });

function toBook(r: Record<string, any>) {
  return {
    id: r.id, name: r.name, description: r.description ?? null, currency: r.currency,
    isStandard: r.is_standard, active: r.active, entryCount: r.entry_count != null ? Number(r.entry_count) : undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function bad(reply: FastifyReply, message: string, code = "VALIDATION_ERROR", status = 400) {
  return reply.status(status).send({ success: false, error: { code, message } });
}

/** Map product id → list price from a price book (active entries only). */
export async function priceBookPrices(tenantId: string, priceBookId: string): Promise<Map<string, number> | null> {
  const { rows: [book] } = await pool.query(
    `SELECT id FROM price_books WHERE id = $1 AND tenant_id = $2 AND active = true`,
    [priceBookId, tenantId],
  );
  if (!book) return null;
  const { rows } = await pool.query(
    `SELECT product_id, unit_price FROM price_book_entries
      WHERE price_book_id = $1 AND tenant_id = $2 AND active = true`,
    [priceBookId, tenantId],
  );
  return new Map(rows.map((r) => [r.product_id as string, Number(r.unit_price)]));
}

export async function priceBooksRoutes(server: FastifyInstance) {
  server.addHook("preHandler", moduleAccessGate("quotes"));

  server.get("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT pb.*, (SELECT count(*) FROM price_book_entries e WHERE e.price_book_id = pb.id) AS entry_count
         FROM price_books pb WHERE pb.tenant_id = $1
        ORDER BY pb.is_standard DESC, pb.name`,
      [request.user.tenantId],
    );
    return reply.send({ success: true, data: rows.map(toBook) });
  });

  server.get("/:id", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const { rows: [row] } = await pool.query(
      `SELECT * FROM price_books WHERE id = $1 AND tenant_id = $2`, [p.data.id, request.user.tenantId],
    );
    if (!row) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toBook(row) });
  });

  server.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = BookSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error.issues[0].message);
    const d = parsed.data;
    const tenantId = request.user.tenantId;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (d.isStandard) {
        await client.query(`UPDATE price_books SET is_standard = false WHERE tenant_id = $1 AND is_standard`, [tenantId]);
      }
      const { rows: [row] } = await client.query(
        `INSERT INTO price_books (tenant_id, name, description, currency, is_standard, active)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, d.name, d.description ?? null, d.currency, d.isStandard, d.active],
      );
      await client.query("COMMIT");
      return reply.status(201).send({ success: true, data: toBook(row) });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (err?.code === "23505") return bad(reply, "A price book with this name already exists", "DUPLICATE_NAME", 409);
      throw err;
    } finally {
      client.release();
    }
  });

  server.patch("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const parsed = BookSchema.partial().safeParse(request.body);
    if (!p.success || !parsed.success) return bad(reply, parsed.success ? "Invalid id" : parsed.error.issues[0].message);
    const d = parsed.data;
    const tenantId = request.user.tenantId;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (d.isStandard === true) {
        await client.query(
          `UPDATE price_books SET is_standard = false WHERE tenant_id = $1 AND is_standard AND id <> $2`,
          [tenantId, p.data.id],
        );
      }
      const { rows: [row] } = await client.query(
        `UPDATE price_books SET
            name = COALESCE($3, name), description = COALESCE($4, description),
            currency = COALESCE($5, currency), is_standard = COALESCE($6, is_standard),
            active = COALESCE($7, active), updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [p.data.id, tenantId, d.name ?? null, d.description ?? null, d.currency ?? null,
         d.isStandard ?? null, d.active ?? null],
      );
      await client.query("COMMIT");
      if (!row) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
      return reply.send({ success: true, data: toBook(row) });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (err?.code === "23505") return bad(reply, "A price book with this name already exists", "DUPLICATE_NAME", 409);
      throw err;
    } finally {
      client.release();
    }
  });

  server.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const { rowCount } = await pool.query(
      `DELETE FROM price_books WHERE id = $1 AND tenant_id = $2`, [p.data.id, request.user.tenantId],
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.status(204).send();
  });

  server.get("/:id/entries", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const { rows } = await pool.query(
      `SELECT e.id, e.product_id, e.unit_price, e.active, pr.name AS product_name, pr.sku
         FROM price_book_entries e JOIN products pr ON pr.id = e.product_id
        WHERE e.price_book_id = $1 AND e.tenant_id = $2
        ORDER BY pr.name`,
      [p.data.id, request.user.tenantId],
    );
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        id: r.id, productId: r.product_id, productName: r.product_name, sku: r.sku ?? null,
        unitPrice: Number(r.unit_price), active: r.active,
      })),
    });
  });

  server.put("/:id/entries", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const parsed = EntriesSchema.safeParse(request.body);
    if (!p.success || !parsed.success) return bad(reply, parsed.success ? "Invalid id" : parsed.error.issues[0].message);
    const tenantId = request.user.tenantId;
    const { rows: [book] } = await pool.query(
      `SELECT id FROM price_books WHERE id = $1 AND tenant_id = $2`, [p.data.id, tenantId],
    );
    if (!book) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    const productIds = [...new Set(parsed.data.entries.map((e) => e.productId))];
    if (productIds.length !== parsed.data.entries.length) return bad(reply, "Duplicate product in entries");
    if (productIds.length) {
      const { rows } = await pool.query(
        `SELECT id FROM products WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, productIds],
      );
      if (rows.length !== productIds.length) return bad(reply, "Unknown product in entries", "UNKNOWN_PRODUCT", 422);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM price_book_entries WHERE price_book_id = $1 AND tenant_id = $2`, [p.data.id, tenantId]);
      if (parsed.data.entries.length) {
        await client.query(
          `INSERT INTO price_book_entries (tenant_id, price_book_id, product_id, unit_price, active)
           SELECT $1, $2, x.product_id, x.unit_price, x.active
             FROM unnest($3::uuid[], $4::numeric[], $5::boolean[]) AS x(product_id, unit_price, active)`,
          [tenantId, p.data.id,
           parsed.data.entries.map((e) => e.productId),
           parsed.data.entries.map((e) => e.unitPrice),
           parsed.data.entries.map((e) => e.active)],
        );
      }
      await client.query(`UPDATE price_books SET updated_at = NOW() WHERE id = $1`, [p.data.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return reply.send({ success: true, data: { count: parsed.data.entries.length } });
  });
}
