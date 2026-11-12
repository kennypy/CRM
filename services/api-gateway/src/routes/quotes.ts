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
import { requireAdmin, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { userHasCapability } from "../middleware/capabilities";
import { moduleAccessGate } from "../middleware/module-access";
import { checkRecordAccess } from "../middleware/record-access";
import { visibleOwnerIdsForList } from "../lib/visibility";
import { priceBookPrices } from "./price-books";
import { checkValidationRules, validationFailureReply } from "../lib/validation-rules";
import { ApprovalError, actOnRequest, submitQuoteForApproval } from "../lib/approvals";
import { SyncError, syncQuoteToDeal } from "../lib/quote-sync";
import { renderQuotePdf } from "../lib/quote-pdf";
import { emitEvent } from "../lib/events";

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
  priceBookId:  z.string().uuid().nullable().optional(),
  items:        z.array(LineItemSchema).min(1, "At least one line item required").max(500),
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

type LineItem = z.infer<typeof LineItemSchema>;

/**
 * List price per line: price-book entry (when the quote has a price book),
 * else the catalog price; null for free-text lines without a product.
 */
async function resolveListPrices(
  tenantId: string, priceBookId: string | null | undefined, items: LineItem[],
): Promise<{ prices: (number | null)[]; error?: string }> {
  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
  const catalog = new Map<string, number>();
  if (productIds.length) {
    const { rows } = await pool.query(
      `SELECT id, unit_price FROM products WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, productIds],
    );
    for (const r of rows) catalog.set(r.id, Number(r.unit_price));
    if (catalog.size !== productIds.length) return { prices: [], error: "Unknown product on a line item" };
  }
  let book: Map<string, number> | null = null;
  if (priceBookId) {
    book = await priceBookPrices(tenantId, priceBookId);
    if (!book) return { prices: [], error: "Price book not found or inactive" };
  }
  const prices = items.map((it) => {
    if (!it.productId) return null;
    if (book) {
      const p = book.get(it.productId);
      return p ?? null;
    }
    return catalog.get(it.productId) ?? null;
  });
  if (book) {
    const missing = items.findIndex((it, i) => it.productId && prices[i] === null);
    if (missing >= 0) return { prices: [], error: `"${items[missing].productName}" is not in the selected price book` };
  }
  return { prices };
}

/**
 * Largest effective discount vs. LIST price across lines. Measuring against
 * list (not the entered unit price) closes the loophole where a rep types a
 * lower unit price with discountPct = 0 and never triggers approval.
 */
function maxLineDiscount(items: LineItem[], listPrices: (number | null)[] = []) {
  return Math.max(0, ...items.map((it, i) => {
    const list = listPrices[i] ?? it.unitPrice;
    if (!(list > 0)) return it.discountPct;
    const net = it.unitPrice * (1 - it.discountPct / 100);
    return Math.max(it.discountPct, Math.round((1 - net / list) * 10000) / 100);
  }));
}

/** Overall discount (line + order level) vs. list, as a percentage. */
function overallDiscountPct(items: LineItem[], listPrices: (number | null)[], discountType: string, discountValue: number) {
  const list = items.reduce((s, it, i) => s + it.quantity * (listPrices[i] ?? it.unitPrice), 0);
  if (list <= 0) return 0;
  const { subtotal } = computeTotals(items, discountType, discountValue, 0);
  const orderDisc = discountType === "percent" ? subtotal * discountValue / 100
    : discountType === "fixed" ? Math.min(discountValue, subtotal) : 0;
  const net = subtotal - orderDisc;
  return Math.max(0, Math.round((1 - net / list) * 10000) / 100);
}

function effectiveDiscount(items: LineItem[], listPrices: (number | null)[], discountType: string, discountValue: number) {
  return Math.max(
    maxLineDiscount(items, listPrices),
    discountType === "percent" ? discountValue : 0,
    overallDiscountPct(items, listPrices, discountType, discountValue),
  );
}

async function nextQuoteNumber(client: { query: typeof pool.query }, tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const { rows: [r] } = await client.query(
    `INSERT INTO quote_counters (tenant_id, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = quote_counters.last_value + 1
     RETURNING last_value`,
    [tenantId, year],
  );
  return `Q-${year}-${String(r.last_value).padStart(4, "0")}`;
}

function rowToItem(it: Record<string, any>): LineItem {
  return {
    productId: it.product_id ?? undefined,
    productName: it.product_name,
    description: it.description ?? undefined,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unit_price),
    discountPct: Number(it.discount_pct),
  };
}

async function getApprovalThreshold(tenantId: string, role?: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT discount_approval_threshold, discount_config FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const flat = rows[0] ? parseFloat(rows[0].discount_approval_threshold) : 10;
  // Prefer a per-role threshold from the persisted discount config when present.
  const cfg = rows[0]?.discount_config ?? {};
  const roleThresholds = cfg?.roleThresholds ?? {};
  if (role && roleThresholds[role] != null && !Number.isNaN(Number(roleThresholds[role]))) {
    return Number(roleThresholds[role]);
  }
  return Number.isNaN(flat) ? 10 : flat;
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
    priceBookId:      r.price_book_id ?? null,
    syncedToDeal:     r.synced_to_deal === true,
    syncedAt:         r.synced_at ?? null,
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
      listPrice:   it.list_price != null ? parseFloat(String(it.list_price)) : null,
      discountPct: parseFloat(String(it.discount_pct)),
      lineTotal:   parseFloat(String(it.line_total)),
      sortOrder:   it.sort_order,
    })),
  };
}

export async function quotesRoutes(server: FastifyInstance) {
  // Custom-role permission grid (Settings → Users → Profiles)
  server.addHook("preHandler", moduleAccessGate("quotes"));
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
    const visible = await visibleOwnerIdsForList(tenantId, request.user.sub, request.user.role, "quote");
    if (visible) {
      vals.push(visible);
      conditions.push(`COALESCE(q.assigned_to, q.created_by) = ANY($${vals.length}::uuid[])`);
    }

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
  server.post("/", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const parsed = CreateQuoteSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const { title, dealId, contactId, companyId, companyName, contactName, currency, notes, terms, validUntil, items, discountType, discountValue, taxRate, priceBookId } = parsed.data;
    const { tenantId, sub: userId } = request.user;

    // Check quoting permission
    const userRow = await pool.query(`SELECT can_quote, role FROM users WHERE id=$1`, [userId]);
    const u = userRow.rows[0];
    if (!u || (!u.can_quote && !["admin","manager"].includes(u.role))) {
      return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: "You don't have permission to create quotes" } });
    }

    const listing = await resolveListPrices(tenantId, priceBookId, items);
    if (listing.error) {
      return reply.status(422).send({ success: false, error: { code: "PRICING_ERROR", message: listing.error } });
    }
    const threshold    = await getApprovalThreshold(tenantId, u.role);
    const effectiveMax = effectiveDiscount(items, listing.prices, discountType, discountValue);

    // Applying any discount requires the 'discount' capability. Admins hold it
    // implicitly; managers/reps must have it granted on their profile — so a
    // manager without the toggle can't discount, only quote at list price.
    const discountApplied = effectiveMax > 0 || (discountType === "fixed" && discountValue > 0);
    if (discountApplied && !(await userHasCapability(u.role, userId, "can_discount"))) {
      return reply.status(403).send({
        success: false,
        error: { code: "CAPABILITY_REQUIRED", message: "You don't have permission to apply discounts. Ask an admin to enable it for your account." },
      });
    }

    const approvalRequired = effectiveMax > threshold;
    const status = approvalRequired ? "pending_approval" : "draft";

    const { subtotal, total } = computeTotals(items, discountType, discountValue, taxRate);

    const vrFailures = await checkValidationRules(tenantId, "quote", {
      title, currency, subtotal, total, discountType, discountValue, taxRate,
      validUntil, dealId, notes, terms, maxDiscountPct: effectiveMax, itemCount: items.length,
    });
    if (vrFailures.length) return validationFailureReply(reply, vrFailures);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const quoteNumber = await nextQuoteNumber(client, tenantId);

      const { rows: [quote] } = await client.query(
        `INSERT INTO quotes
           (tenant_id, quote_number, title, deal_id, contact_id, company_id,
            company_name, contact_name,
            created_by, assigned_to, status, approval_required,
            currency, subtotal, discount_type, discount_value, tax_rate, total,
            notes, terms, valid_until, price_book_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        [tenantId, quoteNumber, title,
          dealId ?? null, contactId ?? null, companyId ?? null,
          companyName ?? null, contactName ?? null,
          userId, status, approvalRequired,
          currency, subtotal, discountType, discountValue, taxRate, total,
          notes ?? null, terms ?? null, validUntil ?? null, priceBookId ?? null]
      );

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const lt = lineTotal(it.quantity, it.unitPrice, it.discountPct);
        await client.query(
          `INSERT INTO quote_items (quote_id, product_id, product_name, description, quantity, unit_price, discount_pct, line_total, sort_order, list_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [quote.id, it.productId ?? null, it.productName, it.description ?? null,
           it.quantity, it.unitPrice, it.discountPct, lt, i, listing.prices[i]]
        );
      }

      await client.query("COMMIT");

      const { rows: savedItems } = await client.query(
        `SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY sort_order`, [quote.id]
      );
      await emitEvent(tenantId, "quote.created", quote.id, {
        dealId: quote.deal_id ?? null, total: Number(quote.total), approvalRequired, quoteNumber: quote.quote_number,
      }, { actorId: userId });
      return reply.status(201).send({ success: true, data: toQuote(quote, savedItems) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // ── GET /api/v1/quotes/:id ───────────────────────────────────────────────
  const aclRead  = checkRecordAccess("quote", "read");
  const aclWrite = checkRecordAccess("quote", "write");

  server.get("/:id", { preHandler: [requireCrmRead, aclRead] }, async (request, reply) => {
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
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId } = request.user;

    const existing = await pool.query(`SELECT * FROM quotes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!existing.rows.length) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    const quote = existing.rows[0];

    // Only draft / pending_approval can be edited
    if (!["draft","pending_approval"].includes(quote.status)) {
      return reply.status(400).send({ success: false, error: { code: "IMMUTABLE", message: "Only draft quotes can be edited" } });
    }
    // Record lock while an approval request is in flight.
    const { rows: openReq } = await pool.query(
      `SELECT 1 FROM approval_requests WHERE tenant_id = $1 AND entity_type = 'quote' AND entity_id = $2 AND status = 'pending'`,
      [tenantId, id],
    );
    if (openReq.length) {
      return reply.status(409).send({ success: false, error: { code: "RECORD_LOCKED", message: "Quote is locked while its approval request is pending. Recall it to edit." } });
    }

    const parsed = UpdateQuoteSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const p = parsed.data;
    const items        = p.items ?? [];
    // Approval must be re-evaluated on EVERY edit (an order-level discount
    // change without items previously skipped it), so load current lines.
    const effItems: LineItem[] = items.length
      ? items
      : (await pool.query(`SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY sort_order`, [id])).rows.map(rowToItem);
    const priceBookId = p.priceBookId !== undefined ? p.priceBookId : quote.price_book_id;
    const listing = await resolveListPrices(tenantId, priceBookId, effItems);
    if (listing.error) {
      return reply.status(422).send({ success: false, error: { code: "PRICING_ERROR", message: listing.error } });
    }
    const discountType  = p.discountType  ?? quote.discount_type;
    const discountValue = p.discountValue ?? parseFloat(quote.discount_value);
    const taxRate       = p.taxRate       ?? parseFloat(quote.tax_rate);

    // Introducing/changing a discount requires the 'discount' capability.
    const discountTouched =
      p.discountType !== undefined ||
      p.discountValue !== undefined ||
      (items.length > 0 && items.some((it) => (it.discountPct ?? 0) > 0));
    const resultingDiscount =
      (discountType === "percent" && discountValue > 0) ||
      (discountType === "fixed" && discountValue > 0) ||
      (items.length > 0 && maxLineDiscount(items, listing.prices) > 0);
    if (discountTouched && resultingDiscount) {
      const role = request.user.role;
      if (!(await userHasCapability(role, userId, "can_discount"))) {
        return reply.status(403).send({
          success: false,
          error: { code: "CAPABILITY_REQUIRED", message: "You don't have permission to apply discounts. Ask an admin to enable it for your account." },
        });
      }
    }

    const { subtotal, total } = computeTotals(effItems, discountType, discountValue, taxRate);

    const threshold = await getApprovalThreshold(tenantId, request.user.role);
    const effectiveMax = effectiveDiscount(effItems, listing.prices, discountType, discountValue);
    const needsApproval = effectiveMax > threshold;
    // An approval covers the discount level it was granted for
    // (approved_discount_pct): edits at or below that level stay approved; any
    // increase beyond it re-requires approval. Reverting back restores it.
    const prevApprovedMax = quote.approved_at ? Number(quote.approved_discount_pct ?? 0) : null;
    const approvalStillValid = prevApprovedMax !== null && effectiveMax <= prevApprovedMax;
    const approvalRequired = needsApproval && !approvalStillValid;
    const status = approvalRequired ? "pending_approval" : "draft";

    const vrFailures = await checkValidationRules(tenantId, "quote", {
      title: p.title ?? quote.title, currency: p.currency ?? quote.currency, subtotal, total,
      discountType, discountValue, taxRate,
      validUntil: p.validUntil !== undefined ? p.validUntil : quote.valid_until,
      dealId: p.dealId !== undefined ? p.dealId : quote.deal_id,
      maxDiscountPct: effectiveMax, itemCount: effItems.length,
    }, {
      title: quote.title, total: Number(quote.total), discountType: quote.discount_type,
      discountValue: Number(quote.discount_value), validUntil: quote.valid_until,
    });
    if (vrFailures.length) return validationFailureReply(reply, vrFailures);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE quotes SET
           title=$3, deal_id=$4, contact_id=$5, company_id=$6,
           currency=$7, subtotal=$8, discount_type=$9, discount_value=$10,
           tax_rate=$11, total=$12, notes=$13, terms=$14, valid_until=$15,
           status=$16, approval_required=$17,
           company_name=$18, contact_name=$19, price_book_id=$20,
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
          p.contactName !== undefined ? (p.contactName ?? null) : quote.contact_name,
          priceBookId ?? null]
      );

      if (items.length || p.priceBookId !== undefined) {
        await client.query(`DELETE FROM quote_items WHERE quote_id=$1`, [id]);
        for (let i = 0; i < effItems.length; i++) {
          const it = effItems[i];
          const lt = lineTotal(it.quantity, it.unitPrice, it.discountPct);
          await client.query(
            `INSERT INTO quote_items (quote_id, product_id, product_name, description, quantity, unit_price, discount_pct, line_total, sort_order, list_price)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [id, it.productId ?? null, it.productName, it.description ?? null,
             it.quantity, it.unitPrice, it.discountPct, lt, i, listing.prices[i]]
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
    if (updated.synced_to_deal && updated.deal_id) {
      await syncQuoteToDeal(request, id).catch((err) => request.log.warn({ err }, "quote_resync_failed"));
    }
    const { rows: updatedItems } = await pool.query(`SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY sort_order`, [id]);
    await emitEvent(tenantId, "quote.updated", id, {
      dealId: updated.deal_id ?? null, total: Number(updated.total), approvalRequired: updated.approval_required,
    }, { actorId: userId });
    return reply.send({ success: true, data: toQuote(updated, updatedItems) });
  });

  // ── DELETE /api/v1/quotes/:id ────────────────────────────────────────────
  server.delete("/:id", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
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
  server.post("/:id/send", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows: [q] } = await pool.query(`SELECT * FROM quotes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!q) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    if (q.status === "pending_approval")
      return reply.status(400).send({ success: false, error: { code: "AWAITING_APPROVAL", message: "Quote requires manager approval before sending" } });
    if (!["draft","sent"].includes(q.status))
      return reply.status(400).send({ success: false, error: { code: "INVALID_STATE", message: `Cannot send a quote in status: ${q.status}` } });

    await pool.query(`UPDATE quotes SET status='sent', sent_at=NOW(), updated_at=NOW() WHERE id=$1`, [id]);
    await emitEvent(tenantId, "quote.sent", id, { dealId: q.deal_id ?? null, total: Number(q.total) },
      { actorId: request.user.sub });
    // TODO: dispatch email via outreach service
    return reply.send({ success: true, message: "Quote marked as sent" });
  });

  // ── POST /api/v1/quotes/:id/submit-for-approval ─────────────────────────
  server.post("/:id/submit-for-approval", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { comment } = (request.body ?? {}) as { comment?: string };
    if (comment !== undefined && (typeof comment !== "string" || comment.length > 2000)) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid comment" } });
    }
    try {
      const data = await submitQuoteForApproval(request.user.tenantId, id, request.user.sub, comment);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      if (err instanceof ApprovalError) {
        return reply.status(err.status).send({ success: false, error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  // ── POST /api/v1/quotes/:id/approve ─────────────────────────────────────
  // Back-compat shortcut: acts on the current step of the quote's pending
  // approval request (submitting one first if needed). Routing, separation of
  // duties and multi-level chains are enforced by the approvals engine.
  server.post("/:id/approve", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId, role } = request.user;
    const { rows: [req] } = await pool.query(
      `SELECT id FROM approval_requests WHERE tenant_id = $1 AND entity_type = 'quote' AND entity_id = $2 AND status = 'pending'`,
      [tenantId, id],
    );
    if (!req) {
      return reply.status(409).send({
        success: false,
        error: { code: "NOT_SUBMITTED", message: "Submit the quote for approval first" },
      });
    }
    try {
      const data = await actOnRequest(tenantId, req.id, userId, role, "approve",
        (request.body as { comment?: string } | undefined)?.comment);
      return reply.send({ success: true, data, message: data?.status === "approved" ? "Quote approved" : "Step approved" });
    } catch (err) {
      if (err instanceof ApprovalError) {
        return reply.status(err.status).send({ success: false, error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  // ── GET /api/v1/quotes/:id/pdf ──────────────────────────────────────────
  server.get("/:id/pdf", { preHandler: [requireCrmRead, aclRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows: [q] } = await pool.query(
      `SELECT q.*, u.first_name || ' ' || u.last_name AS created_by_name, t.name AS tenant_name
         FROM quotes q
         LEFT JOIN users u ON u.id = q.created_by
         JOIN tenants t ON t.id = q.tenant_id
        WHERE q.id = $1 AND q.tenant_id = $2`,
      [id, tenantId],
    );
    if (!q) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    const { rows: items } = await pool.query(
      `SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order`, [id],
    );
    const pdf = await renderQuotePdf({
      quoteNumber: q.quote_number, title: q.title, status: q.status, currency: q.currency,
      subtotal: Number(q.subtotal), discountType: q.discount_type, discountValue: Number(q.discount_value),
      taxRate: Number(q.tax_rate), total: Number(q.total), companyName: q.company_name,
      contactName: q.contact_name, validUntil: q.valid_until, createdAt: q.created_at,
      notes: q.notes, terms: q.terms, preparedBy: q.created_by_name,
      items: items.map((it) => ({
        productName: it.product_name, description: it.description, quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price), discountPct: Number(it.discount_pct), lineTotal: Number(it.line_total),
      })),
    }, { sellerName: q.tenant_name ?? "NexCRM" });
    const safeName = String(q.quote_number).replace(/[^A-Za-z0-9_-]/g, "_");
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${safeName}.pdf"`)
      .header("Cache-Control", "private, no-store")
      .send(Buffer.from(pdf));
  });

  // ── POST /api/v1/quotes/:id/sync ────────────────────────────────────────
  server.post("/:id/sync", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const data = await syncQuoteToDeal(request, id);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof SyncError) {
        return reply.status(err.status).send({ success: false, error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });

  // ── POST /api/v1/quotes/:id/status ──────────────────────────────────────
  // For external status transitions: viewed, accepted, rejected
  server.post("/:id/status", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { status } = request.body as { status: string };

    const ALLOWED = ["viewed","accepted","rejected"];
    if (!ALLOWED.includes(status))
      return reply.status(400).send({ success: false, error: { code: "INVALID_STATUS" } });

    const { rows: [cur] } = await pool.query(
      `SELECT status, approval_required FROM quotes WHERE id=$1 AND tenant_id=$2`, [id, tenantId],
    );
    if (!cur) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    // A quote can only be viewed/accepted/rejected by the customer once it has
    // been sent — previously a pending-approval quote could be marked accepted,
    // bypassing approval entirely.
    if (cur.approval_required || cur.status === "pending_approval") {
      return reply.status(409).send({ success: false, error: { code: "AWAITING_APPROVAL", message: "Quote requires approval first" } });
    }
    const allowedFrom: Record<string, string[]> = {
      viewed: ["sent", "viewed"], accepted: ["sent", "viewed"], rejected: ["sent", "viewed"],
    };
    if (!allowedFrom[status].includes(cur.status)) {
      return reply.status(409).send({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot move a ${cur.status} quote to ${status}` } });
    }
    const tsCol: Record<string, string> = { viewed: "viewed_at", accepted: "accepted_at", rejected: "rejected_at" };
    await pool.query(
      `UPDATE quotes SET status=$2, ${tsCol[status]}=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$3`,
      [id, status, tenantId]
    );
    if (status === "accepted" || status === "rejected") {
      const { rows: [q2] } = await pool.query(`SELECT deal_id, total FROM quotes WHERE id = $1`, [id]);
      await emitEvent(tenantId, `quote.${status}`, id, { dealId: q2?.deal_id ?? null, total: Number(q2?.total ?? 0) },
        { actorId: request.user.sub });
    }
    return reply.send({ success: true });
  });
}
