/**
 * Products CSV import with smart (Salesforce-style) header mapping.
 *
 * Two steps:
 *   POST /api/v1/products/import/analyze  { csv }
 *     → parses headers + samples, proposes a mapping: each column maps to a
 *       standard product field, an existing product custom field, or a NEW
 *       custom field (with an inferred type) that would be created on import.
 *   POST /api/v1/products/import/commit   { csv, mapping }
 *     → creates any 'new' custom fields on the product entity, then upserts the
 *       products (standard columns → real columns, everything else → the
 *       products.custom_fields JSONB bag). Dedupes on SKU within the tenant.
 *
 * Admin-only. Processing is synchronous and capped (products lists are small).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireAdmin } from "../middleware/rbac";

const MAX_ROWS = 5000;

// ── CSV parsing (RFC-4180-ish: quoted fields, escaped "", CRLF/LF, BOM) ───────
function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully-empty rows.
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// ── Standard product fields + their Salesforce/common header synonyms ─────────
const STANDARD_SYNONYMS: Record<string, string[]> = {
  name:          ["name", "product name", "product", "title", "productname"],
  sku:           ["sku", "product code", "code", "part number", "item number", "productcode", "item id", "item"],
  description:   ["description", "desc", "details", "product description", "long description"],
  unit_price:    ["unit price", "price", "list price", "amount", "cost", "unitprice", "sales price", "standard price", "default price"],
  currency:      ["currency", "currency code", "iso currency", "currencyisocode"],
  billing_cycle: ["billing cycle", "billing", "billing frequency", "term", "frequency"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

function matchStandard(header: string): string | null {
  const n = norm(header);
  for (const [field, syns] of Object.entries(STANDARD_SYNONYMS)) {
    if (syns.includes(n)) return field;
  }
  return null;
}

function toFieldKey(header: string): string {
  let k = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!k) k = "field";
  if (!/^[a-z]/.test(k)) k = "f_" + k;
  return k.slice(0, 60);
}

function inferType(samples: string[]): string {
  const vals = samples.map((s) => s.trim()).filter(Boolean);
  if (!vals.length) return "text";
  if (vals.every((v) => /^-?[$£€]?\s?[\d,]+(\.\d+)?%?$/.test(v))) return "number";
  if (vals.every((v) => /^(true|false|yes|no|y|n|0|1)$/i.test(v))) return "boolean";
  if (vals.every((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) return "email";
  if (vals.every((v) => /^https?:\/\//i.test(v))) return "url";
  if (vals.every((v) => /\d/.test(v) && !isNaN(Date.parse(v)))) return "date";
  return "text";
}

const parseNumber = (v: string): number | null => {
  const cleaned = v.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
};

const BILLING = new Map<string, string>([
  ["one_time", "one_time"], ["one time", "one_time"], ["onetime", "one_time"], ["one-time", "one_time"],
  ["monthly", "monthly"], ["month", "monthly"], ["mo", "monthly"],
  ["annual", "annual"], ["annually", "annual"], ["yearly", "annual"], ["year", "annual"], ["yr", "annual"],
]);

const AnalyzeSchema = z.object({ csv: z.string().min(1).max(20_000_000) });
const MappingItem = z.object({
  header: z.string(),
  index: z.number().int().min(0),
  target: z.enum(["standard", "custom_existing", "new", "skip"]),
  field: z.string().optional(),        // standard field name
  fieldKey: z.string().optional(),     // custom field key (existing or new)
  fieldLabel: z.string().optional(),   // new custom field label
  fieldType: z.string().optional(),    // new custom field type
});
const CommitSchema = z.object({ csv: z.string().min(1).max(20_000_000), mapping: z.array(MappingItem).min(1) });

async function existingProductFieldKeys(tenantId: string): Promise<Set<string>> {
  const { rows } = await pool.query(
    `SELECT field_key FROM custom_field_definitions
     WHERE tenant_id = $1 AND entity_type = 'product' AND is_active`,
    [tenantId]
  );
  return new Set(rows.map((r) => r.field_key));
}

export async function productsImportRoutes(server: FastifyInstance) {
  // ── Analyze ──────────────────────────────────────────────────────────────
  server.post("/analyze", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = AnalyzeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId } = request.user;

    const rows = parseCsv(parsed.data.csv);
    if (rows.length < 2) return reply.status(400).send({ success: false, error: { code: "EMPTY_CSV", message: "The file has no data rows." } });

    const headers = rows[0].map((h) => h.trim());
    const dataRows = rows.slice(1, MAX_ROWS + 1);
    const existing = await existingProductFieldKeys(tenantId);
    const usedKeys = new Set<string>();

    const mapping = headers.map((header, index) => {
      const samples = dataRows.slice(0, 20).map((r) => r[index] ?? "");
      const std = matchStandard(header);
      if (std) return { header, index, target: "standard", field: std, sample: samples.find((s) => s.trim()) ?? "" };

      // Existing product custom field with a matching key?
      let key = toFieldKey(header);
      if (existing.has(key)) return { header, index, target: "custom_existing", fieldKey: key, sample: samples.find((s) => s.trim()) ?? "" };

      // New custom field — ensure the suggested key is unique within this import.
      let base = key, n = 2;
      while (usedKeys.has(key) || existing.has(key)) { key = `${base}_${n++}`.slice(0, 60); }
      usedKeys.add(key);
      return { header, index, target: "new", fieldKey: key, fieldLabel: header, fieldType: inferType(samples), sample: samples.find((s) => s.trim()) ?? "" };
    });

    return reply.send({
      success: true,
      data: {
        headers,
        rowCount: dataRows.length,
        mapping,
        sampleRows: dataRows.slice(0, 5),
      },
    });
  });

  // ── Commit ───────────────────────────────────────────────────────────────
  server.post("/commit", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = CommitSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    const { tenantId, sub: userId } = request.user;

    const rows = parseCsv(parsed.data.csv);
    if (rows.length < 2) return reply.status(400).send({ success: false, error: { code: "EMPTY_CSV", message: "The file has no data rows." } });
    const dataRows = rows.slice(1, MAX_ROWS + 1);
    const mapping = parsed.data.mapping;

    // 1) Create any NEW custom fields on the product entity.
    let fieldsCreated = 0;
    for (const m of mapping) {
      if (m.target !== "new" || !m.fieldKey) continue;
      const key = toFieldKey(m.fieldKey);
      const type = ["text", "number", "date", "boolean", "email", "url", "currency"].includes(m.fieldType ?? "") ? m.fieldType! : "text";
      const res = await pool.query(
        `INSERT INTO custom_field_definitions (tenant_id, entity_type, field_key, field_label, field_type, created_by)
         VALUES ($1, 'product', $2, $3, $4, $5)
         ON CONFLICT (tenant_id, entity_type, custom_object_id, field_key) DO NOTHING`,
        [tenantId, key, m.fieldLabel || m.header, type, userId]
      ).catch(() => ({ rowCount: 0 }));
      if (res.rowCount) fieldsCreated++;
    }

    // 2) Upsert products row by row.
    const stdCols = new Map<string, number>(); // field -> column index
    const customCols: { key: string; index: number }[] = [];
    for (const m of mapping) {
      if (m.target === "standard" && m.field) stdCols.set(m.field, m.index);
      else if ((m.target === "new" || m.target === "custom_existing") && m.fieldKey) customCols.push({ key: toFieldKey(m.fieldKey), index: m.index });
    }
    const nameIdx = stdCols.get("name");
    if (nameIdx === undefined) {
      return reply.status(400).send({ success: false, error: { code: "NO_NAME", message: "Map a column to the product Name before importing." } });
    }

    let created = 0, updated = 0, skipped = 0;
    const errors: { row: number; message: string }[] = [];

    for (let r = 0; r < dataRows.length; r++) {
      const cells = dataRows[r];
      const name = (cells[nameIdx] ?? "").trim();
      if (!name) { skipped++; errors.push({ row: r + 2, message: "Missing product name" }); continue; }

      const sku = stdCols.has("sku") ? (cells[stdCols.get("sku")!] ?? "").trim() || null : null;
      const description = stdCols.has("description") ? (cells[stdCols.get("description")!] ?? "").trim() || null : null;
      const unitPrice = stdCols.has("unit_price") ? parseNumber(cells[stdCols.get("unit_price")!] ?? "") : null;
      const currency = stdCols.has("currency") ? ((cells[stdCols.get("currency")!] ?? "").trim().toUpperCase().slice(0, 3) || null) : null;
      const billing = stdCols.has("billing_cycle") ? (BILLING.get(norm(cells[stdCols.get("billing_cycle")!] ?? "")) ?? null) : null;

      const custom: Record<string, string> = {};
      for (const c of customCols) {
        const v = (cells[c.index] ?? "").trim();
        if (v) custom[c.key] = v;
      }

      try {
        // Dedupe on SKU within the tenant when a SKU is present.
        let existingId: string | null = null;
        if (sku) {
          const { rows: ex } = await pool.query(`SELECT id FROM products WHERE tenant_id = $1 AND sku = $2 AND active LIMIT 1`, [tenantId, sku]);
          existingId = ex[0]?.id ?? null;
        }
        if (existingId) {
          await pool.query(
            `UPDATE products SET name = $1, description = COALESCE($2, description),
               unit_price = COALESCE($3, unit_price), currency = COALESCE($4, currency),
               billing_cycle = COALESCE($5, billing_cycle),
               custom_fields = custom_fields || $6::jsonb, updated_at = NOW()
             WHERE id = $7 AND tenant_id = $8`,
            [name, description, unitPrice, currency, billing, JSON.stringify(custom), existingId, tenantId]
          );
          updated++;
        } else {
          await pool.query(
            `INSERT INTO products (tenant_id, sku, name, description, unit_price, currency, billing_cycle, custom_fields)
             VALUES ($1, $2, $3, $4, COALESCE($5::numeric, 0), COALESCE($6, 'USD'), COALESCE($7, 'one_time'), $8::jsonb)`,
            [tenantId, sku, name, description, unitPrice, currency, billing, JSON.stringify(custom)]
          );
          created++;
        }
      } catch (err: any) {
        skipped++;
        errors.push({ row: r + 2, message: err?.message?.slice(0, 200) ?? "Insert failed" });
      }
    }

    return reply.send({
      success: true,
      data: { created, updated, skipped, fieldsCreated, total: dataRows.length, errors: errors.slice(0, 50) },
    });
  });
}
