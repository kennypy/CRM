/**
 * Quotes routes
 * GET    /api/v1/quotes                 — list quotes for tenant (filterable)
 * POST   /api/v1/quotes                 — create quote + line items
 * GET    /api/v1/quotes/:id             — get quote with items
 * PATCH  /api/v1/quotes/:id             — update quote / items
 * DELETE /api/v1/quotes/:id             — delete draft quote
 * POST   /api/v1/quotes/:id/send        — mark sent (email dispatch placeholder)
 * POST   /api/v1/quotes/:id/approve     — manager approves discount
 * POST   /api/v1/quotes/:id/status      — update status (viewed/accepted/rejected)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";

const LineItemSchema = z.object({
  productId:   z.string().uuid().optional(),
  productName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  quantity:    z.number().min(0.001),
  unitPrice:   z.number().min(0),
  discountPct: z.number().min(0).max(100).default(0),
});

const CreateQuoteSchema = z.object({
  title:        z.string().min(1).max(300),
  dealId:       z.string().uuid().optional(),
  contactId:    z.string().uuid().optional(),
  companyId:    z.string().uuid().optional(),
  companyName:  z.string().max(300).optional(),   // denormalised — graph entity name
  contactName:  z.string().max(300).optional(),   // denormalised — graph entity name
  currency:     z.string().length(3).default("USD"),
  notes:        z.string().max(5000).optional(),
  terms:        z.string().max(5000).optional(),
  validUntil:   z.string().optional(),   // ISO date string
  items:        z.array(LineItemSchema).min(1, "At least one line item required"),
  discountType:  z.enum(["none","percent","fixed"]).default("none"),
  discountValue: z.number().min(0).default(0),
  taxRate:       z.number().min(0).max(100).default(0),
});

const UpdateQuoteSchema = CreateQuoteSchema.partial();

function lineTotal(qty: number, unitPrice: number, discountPct: number) {
  return Math.round(qty * unitPrice * (1 - discountPct / 100) * 100) / 100;
}

function computeTotals(items: z.infer<typeof LineItemSchema>[], discountType: string, discountValue: number, taxRate: number) {
  const subtotal = items.reduce((s, it) => s + lineTotal(it.quantity, it.unitPrice, it.discountPct), 0);
  let orderDiscount = 0;
  if (discountType === "percent") orderDiscount = Math.round(subtotal * discountValue / 100 * 100) / 100;
  if (discountType === "fixed")   orderDiscount = Math.min(discountValue, subtotal);
  const afterDiscount = subtotal - orderDiscount;
  const tax   = Math.round(afterDiscount * taxRate / 100 * 100) / 100;
  const total = afterDiscount + tax;
  return { subtotal, total };
}

function maxLineDiscount(items: z.infer<typeof LineItemSchema>[]) {
  return Math.max(0, ...items.map((it) => it.discountPct));
}

async function getApprovalThreshold(tenantId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT discount_approval_threshold FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return rows[0] ? parseFloat(rows[0].discount_approval_threshold) : 10;
}

function toQuote(r: Record<string, unknown>, items: Record<string, unknown>[] = []) {
  return {
    id:               r.id,
    quoteNumber:      r.quote_number,
    title:            r.title,
    status:           r.status,
    approvalRequired: r.approval_required,
    approvedBy:       r.approved_by ?? null,
    approvedAt:       r.approved_at ?? null,
    dealId:           r.deal_id ?? null,
    contactId:        r.contact_id ?? null,
    companyId:        r.company_id ?? null,
    companyName:      r.company_name ?? null,
    contactName:      r.contact_name ?? null,
    createdBy:        r.created_by,
    createdByName:    r.created_by_name ?? null,
    assignedTo:       r.assigned_to ?? null,
    currency:         r.currency,
    subtotal:         parseFloat(String(r.subtotal)),
    discountType:     r.discount_type,
    discountValue:    parseFloat(String(r.discount_value)),
    taxRate:          parseFloat(String(r.tax_rate)),
    total:            parseFloat(String(r.total)),
    relatedTo:        r.related_to  ?? null,
    notes:            r.notes       ?? null,
    terms:            r.terms       ?? null,
    validUntil:       r.valid_until ?? null,
    sentAt:           r.sent_at ?? null,
    viewedAt:         r.viewed_at ?? null,
    acceptedAt:       r.accepted_at ?? null,
    rejectedAt:       r.rejected_at ?? null,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
    items: items.map((it) => ({
      id:          it.id,
      productId:   it.product_id ?? null,
      productName: it.product_name,
      description: it.description ?? null,
      quantity:    parseFloat(String(it.quantity)),
      unitPrice:   parseFloat(String(it.unit_price)),
      discountPct: parseFloat(String(it.discount_pct)),
      lineTotal:   parseFloat(String(it.line_total)),
      sortOrder:   it.sort_order,
    })),
  };
}

export async function quotesRoutes(server: FastifyInstance) {
  // ── GET /api/v1/quotes ───────────────────────────────────────────────────
  server.get("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const conditions: string[] = ["q.tenant_id = $1"];
    const vals: unknown[] = [tenantId];

    if (q.dealId)    { vals.push(q.dealId);    conditions.push(`q.deal_id    = $${vals.length}`); }
    if (q.companyId) { vals.push(q.companyId); conditions.push(`q.company_id = $${vals.length}`); }
    if (q.contactId) { vals.push(q.contactId); conditions.push(`q.contact_id = $${vals.length}`); }
    if (q.status)    { vals.push(q.status);    conditions.push(`q.status     = $${vals.length}`); }

    const { rows } = await pool.query(
      `SELECT q.*,
              u.first_name || ' ' || u.last_name AS created_by_name
       FROM quotes q
       LEFT JOIN users u ON u.id = q.created_by
       WHERE ${conditions.join(" AND ")}
       ORDER BY q.created_at DESC
       LIMIT 200`,
      vals
    );

    return reply.send({ success: true, data: rows.map((r) => toQuote(r)) });
  });

  // ── POST /api/v1/quotes ──────────────────────────────────────────────────
  server.post("/", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const parsed = CreateQuoteSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const { title, dealId, contactId, companyId, companyName, contactName, currency, notes, terms, validUntil, items, discountType, discountValue, taxRate } = parsed.data;
    const { tenantId, sub: userId } = request.user;

    // Check quoting permission
    const userRow = await pool.query(`SELECT can_quote, role FROM users WHERE id=$1`, [userId]);
    const u = userRow.rows[0];
    if (!u || (!u.can_quote && !["admin","manager"].includes(u.role))) {
      return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "You don't have permission to create quotes" } });
    }

    const threshold   = await getApprovalThreshold(tenantId);
    const maxDiscount = maxLineDiscount(items);
    // Also check order-level discount if percent type
    const effectiveMax = discountType === "percent" ? Math.max(maxDiscount, discountValue) : maxDiscount;
    const approvalRequired = effectiveMax > threshold;
    const status = approvalRequired ? "pending_approval" : "draft";

    const { subtotal, total } = computeTotals(items, discountType, discountValue, taxRate);
    const quoteNumber = `Q-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: [quote] } = await client.query(
        `INSERT INTO quotes
           (tenant_id, quote_number, title, deal_id, contact_id, company_id,
            company_name, contact_name,
            created_by, assigned_to, status, approval_required,
            currency, subtotal, discount_type, discount_value, tax_rate, total,
            notes, terms, valid_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [tenantId, quoteNumber, title,
          dealId ?? null, contactId ?? null, companyId ?? null,
          companyName ?? null, contactName ?? null,
          userId, status, approvalRequired,
          currency, subtotal, discountType, discountValue, taxRate, total,
          notes ?? null, terms ?? null, validUntil ?? null]
      );

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const lt = lineTotal(it.quantity, it.unitPrice, it.discountPct);
        await client.query(
          `INSERT INTO quote_items (quote_id, product_id, product_name, description, quantity, unit_price, discount_pct, line_total, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [quote.id, it.productId ?? null, it.productName, it.description ?? null,
           it.quantity, it.unitPrice, it.discountPct, lt, i]
        );
      }

      await client.query("COMMIT");

      const { rows: savedItems } = await client.query(
        `SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY sort_order`, [quote.id]
      );
      return reply.status(201).send({ success: true, data: toQuote(quote, savedItems) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // ── GET /api/v1/quotes/:id ───────────────────────────────────────────────
  server.get("/:id", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows: [quote] } = await pool.query(
      `SELECT q.*,
              u.first_name || ' ' || u.last_name AS created_by_name
       FROM quotes q
       LEFT JOIN users u ON u.id = q.created_by
       WHERE q.id=$1 AND q.tenant_id=$2`, [id, tenantId]
    );
    if (!quote) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    const { rows: items } = await pool.query(
      `SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY sort_order`, [id]
    );

    return reply.send({ success: true, data: toQuote(quote, items) });
  });

  // ── PATCH /api/v1/quotes/:id ─────────────────────────────────────────────
  server.patch("/:id", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId } = request.user;

    const existing = await pool.query(`SELECT * FROM quotes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!existing.rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    const quote = existing.rows[0];

    // Only draft / pending_approval can be edited
    if (!["draft","pending_approval"].includes(quote.status)) {
      return reply.status(400).send({ success: false, error: { code: "IMMUTABLE", message: "Only draft quotes can be edited" } });
    }

    const parsed = UpdateQuoteSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const p = parsed.data;
    const items        = p.items ?? [];
    const discountType  = p.discountType  ?? quote.discount_type;
    const discountValue = p.discountValue ?? parseFloat(quote.discount_value);
    const taxRate       = p.taxRate       ?? parseFloat(quote.tax_rate);

    const { subtotal, total } = items.length
      ? computeTotals(items, discountType, discountValue, taxRate)
      : { subtotal: parseFloat(quote.subtotal), total: parseFloat(quote.total) };

    let approvalRequired = quote.approval_required;
    let status = quote.status;
    if (items.length) {
      const threshold = await getApprovalThreshold(tenantId);
      const effectiveMax = Math.max(maxLineDiscount(items), discountType === "percent" ? discountValue : 0);
      approvalRequired = effectiveMax > threshold;
      status = approvalRequired ? "pending_approval" : "draft";
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE quotes SET
           title=$3, deal_id=$4, contact_id=$5, company_id=$6,
           currency=$7, subtotal=$8, discount_type=$9, discount_value=$10,
           tax_rate=$11, total=$12, notes=$13, terms=$14, valid_until=$15,
           status=$16, approval_required=$17,
           company_name=$18, contact_name=$19,
           updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId,
          p.title     ?? quote.title,
          p.dealId    !== undefined ? (p.dealId ?? null)    : quote.deal_id,
          p.contactId !== undefined ? (p.contactId ?? null) : quote.contact_id,
          p.companyId !== undefined ? (p.companyId ?? null) : quote.company_id,
          p.currency  ?? quote.currency,
          subtotal, discountType, discountValue, taxRate, total,
          p.notes  !== undefined ? (p.notes  ?? null) : quote.notes,
          p.terms  !== undefined ? (p.terms  ?? null) : quote.terms,
          p.validUntil !== undefined ? (p.validUntil ?? null) : quote.valid_until,
          status, approvalRequired,
          p.companyName !== undefined ? (p.companyName ?? null) : quote.company_name,
          p.contactName !== undefined ? (p.contactName ?? null) : quote.contact_name]
      );

      if (items.length) {
        await client.query(`DELETE FROM quote_items WHERE quote_id=$1`, [id]);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const lt = lineTotal(it.quantity, it.unitPrice, it.discountPct);
          await client.query(
            `INSERT INTO quote_items (quote_id, product_id, product_name, description, quantity, unit_price, discount_pct, line_total, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [id, it.productId ?? null, it.productName, it.description ?? null,
             it.quantity, it.unitPrice, it.discountPct, lt, i]
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const { rows: [updated] } = await pool.query(`SELECT * FROM quotes WHERE id=$1`, [id]);
    const { rows: updatedItems } = await pool.query(`SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY sort_order`, [id]);
    return reply.send({ success: true, data: toQuote(updated, updatedItems) });
  });

  // ── DELETE /api/v1/quotes/:id ────────────────────────────────────────────
  server.delete("/:id", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows: [q] } = await pool.query(`SELECT status FROM quotes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!q) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    if (!["draft","pending_approval"].includes(q.status))
      return reply.status(400).send({ success: false, error: { code: "IMMUTABLE", message: "Only draft quotes can be deleted" } });

    await pool.query(`DELETE FROM quotes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return reply.status(204).send();
  });

  // ── POST /api/v1/quotes/:id/send ─────────────────────────────────────────
  server.post("/:id/send", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows: [q] } = await pool.query(`SELECT * FROM quotes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!q) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    if (q.status === "pending_approval")
      return reply.status(400).send({ success: false, error: { code: "AWAITING_APPROVAL", message: "Quote requires manager approval before sending" } });
    if (!["draft","sent"].includes(q.status))
      return reply.status(400).send({ success: false, error: { code: "INVALID_STATE", message: `Cannot send a quote in status: ${q.status}` } });

    await pool.query(`UPDATE quotes SET status='sent', sent_at=NOW(), updated_at=NOW() WHERE id=$1`, [id]);
    // TODO: dispatch email via outreach service
    return reply.send({ success: true, message: "Quote marked as sent" });
  });

  // ── POST /api/v1/quotes/:id/approve ─────────────────────────────────────
  server.post("/:id/approve", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId } = request.user;

    // Check approver role
    const { rows: [approver] } = await pool.query(`SELECT role FROM users WHERE id=$1`, [userId]);
    if (!approver || !["admin","manager"].includes(approver.role))
      return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "Only managers/admins can approve quotes" } });

    const { rows: [q] } = await pool.query(`SELECT * FROM quotes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!q) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    if (q.status !== "pending_approval")
      return reply.status(400).send({ success: false, error: { code: "INVALID_STATE", message: "Quote is not pending approval" } });

    await pool.query(
      `UPDATE quotes SET status='draft', approved_by=$2, approved_at=NOW(), approval_required=false, updated_at=NOW() WHERE id=$1`,
      [id, userId]
    );
    return reply.send({ success: true, message: "Quote approved" });
  });

  // ── POST /api/v1/quotes/:id/status ──────────────────────────────────────
  // For external status transitions: viewed, accepted, rejected
  server.post("/:id/status", { preHandler: [requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { status } = request.body as { status: string };

    const ALLOWED = ["viewed","accepted","rejected"];
    if (!ALLOWED.includes(status))
      return reply.status(400).send({ success: false, error: { code: "INVALID_STATUS" } });

    const tsCol: Record<string, string> = { viewed: "viewed_at", accepted: "accepted_at", rejected: "rejected_at" };
    await pool.query(
      `UPDATE quotes SET status=$2, ${tsCol[status]}=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$3`,
      [id, status, tenantId]
    );
    return reply.send({ success: true });
  });
}
