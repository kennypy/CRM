/**
 * Product catalog routes
 * GET    /api/v1/products          — list active products for tenant
 * POST   /api/v1/products          — admin: create product
 * PATCH  /api/v1/products/:id      — admin: update product
 * DELETE /api/v1/products/:id      — admin: deactivate (soft-delete)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";

const ProductSchema = z.object({
  sku:          z.string().max(100).optional(),
  name:         z.string().min(1).max(200),
  description:  z.string().max(2000).optional(),
  unitPrice:    z.number().min(0),
  currency:     z.string().length(3).default("USD"),
  billingCycle: z.enum(["one_time", "monthly", "annual"]).default("one_time"),
  active:       z.boolean().default(true),
});

const UpdateProductSchema = ProductSchema.partial();

function toProduct(r: Record<string, unknown>) {
  return {
    id:           r.id,
    sku:          r.sku ?? null,
    name:         r.name,
    description:  r.description ?? null,
    unitPrice:    parseFloat(String(r.unit_price)),
    currency:     r.currency,
    billingCycle: r.billing_cycle,
    active:       r.active,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  };
}

export async function productsRoutes(server: FastifyInstance) {
  // GET /api/v1/products
  server.get("/", async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT * FROM products WHERE tenant_id = $1 AND active = true ORDER BY name ASC`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows.map(toProduct) });
  });

  // GET /api/v1/products/all — includes inactive, admin only
  server.get("/all", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT * FROM products WHERE tenant_id = $1 ORDER BY name ASC`,
      [tenantId]
    );
    return reply.send({ success: true, data: rows.map(toProduct) });
  });

  // POST /api/v1/products
  server.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = ProductSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const { sku, name, description, unitPrice, currency, billingCycle, active } = parsed.data;
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `INSERT INTO products (tenant_id, sku, name, description, unit_price, currency, billing_cycle, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [tenantId, sku ?? null, name, description ?? null, unitPrice, currency, billingCycle, active]
    );
    return reply.status(201).send({ success: true, data: toProduct(rows[0]) });
  });

  // PATCH /api/v1/products/:id
  server.patch("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const parsed = UpdateProductSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [id, tenantId];

    const p = parsed.data;
    if (p.sku          !== undefined) { vals.push(p.sku);          sets.push(`sku           = $${vals.length}`); }
    if (p.name         !== undefined) { vals.push(p.name);         sets.push(`name          = $${vals.length}`); }
    if (p.description  !== undefined) { vals.push(p.description);  sets.push(`description   = $${vals.length}`); }
    if (p.unitPrice    !== undefined) { vals.push(p.unitPrice);    sets.push(`unit_price    = $${vals.length}`); }
    if (p.currency     !== undefined) { vals.push(p.currency);     sets.push(`currency      = $${vals.length}`); }
    if (p.billingCycle !== undefined) { vals.push(p.billingCycle); sets.push(`billing_cycle = $${vals.length}`); }
    if (p.active       !== undefined) { vals.push(p.active);       sets.push(`active        = $${vals.length}`); }

    if (sets.length === 1) return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });

    const { rows } = await pool.query(
      `UPDATE products SET ${sets.join(",")} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      vals
    );
    if (!rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toProduct(rows[0]) });
  });

  // DELETE /api/v1/products/:id — soft-delete (set active=false)
  server.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rowCount } = await pool.query(
      `UPDATE products SET active=false, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId]
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.status(204).send();
  });
}
