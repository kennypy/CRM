/**
 * Lead management routes (/api/v1/leads)
 *
 *   POST   /:id/convert               lead → account + contact (+ opportunity)
 *   POST   /:id/assign                run assignment rules for one lead
 *   GET    /assignment-rules          list rules
 *   POST   /assignment-rules          create rule            (admin)
 *   PATCH  /assignment-rules/:id      update rule            (admin)
 *   DELETE /assignment-rules/:id      delete rule            (admin)
 *   GET    /web-forms                 list web-to-lead forms (admin)
 *   POST   /web-forms                 create form            (admin)
 *   PATCH  /web-forms/:id             update form            (admin)
 *   DELETE /web-forms/:id             delete form            (admin)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool } from "../db";
import { requireAdmin, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { checkRecordAccess } from "../middleware/record-access";
import { moduleAccessGate } from "../middleware/module-access";
import { internalFetch, internalIdentityHeaders } from "../lib/internal-fetch";
import { GRAPH_CORE_URL } from "../lib/service-urls";
import { checkValidationRules, validationFailureReply } from "../lib/validation-rules";
import { createProxy } from "../lib/proxy";
import { applyListVisibility } from "../lib/list-visibility";
import {
  AssignmentConditionSchema, leadFactsFromContact, pickAssignee, setLeadOwner,
} from "../lib/lead-assignment";

const ConvertSchema = z.object({
  companyId:     z.string().uuid().optional(),
  companyName:   z.string().min(1).max(300).optional(),
  companyDomain: z.string().min(3).max(253).optional(),
  createDeal:    z.boolean().default(true),
  dealName:      z.string().min(1).max(300).optional(),
  dealValue:     z.number().min(0).max(1_000_000_000_000).optional(),
  dealCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dealStage:     z.enum(["lead", "qualified", "discovery", "proposal", "negotiation"]).default("qualified"),
  currency:      z.string().length(3).optional(),
  ownerId:       z.string().uuid().optional(),
});

const RuleSchema = z.object({
  name:         z.string().min(1).max(200),
  priority:     z.number().int().min(0).max(10_000).default(100),
  active:       z.boolean().default(true),
  conditions:   z.array(AssignmentConditionSchema).max(20).default([]),
  assignToType: z.enum(["user", "team_round_robin"]),
  assignToId:   z.string().uuid(),
});

const OriginSchema = z.string().max(253).regex(/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/, "Origin must look like https://example.com");
const FormSchema = z.object({
  name:           z.string().min(1).max(200),
  allowedOrigins: z.array(OriginSchema).max(50).default([]),
  defaultSource:  z.string().min(1).max(50).default("web"),
  active:         z.boolean().default(true),
});

const IdParam = z.object({ id: z.string().uuid() });

function toRule(r: Record<string, any>) {
  return {
    id: r.id, name: r.name, priority: r.priority, active: r.active,
    conditions: r.conditions ?? [], assignToType: r.assign_to_type, assignToId: r.assign_to_id,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toForm(r: Record<string, any>) {
  return {
    id: r.id, name: r.name, formKey: r.form_key, allowedOrigins: r.allowed_origins ?? [],
    defaultSource: r.default_source, active: r.active, submissions: r.submissions,
    createdAt: r.created_at,
  };
}

function bad(reply: FastifyReply, message: string, code = "VALIDATION_ERROR", status = 400) {
  return reply.status(status).send({ success: false, error: { code, message } });
}

async function assertAssignee(tenantId: string, type: string, id: string): Promise<boolean> {
  const sql = type === "user"
    ? `SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`
    : `SELECT 1 FROM teams WHERE id = $1 AND tenant_id = $2`;
  const { rows } = await pool.query(sql, [id, tenantId]);
  return rows.length > 0;
}

async function fetchContact(request: FastifyRequest, id: string): Promise<Record<string, unknown> | null> {
  const tenantId = request.user.tenantId;
  const res = await internalFetch(
    `${GRAPH_CORE_URL}/contacts/${encodeURIComponent(id)}?tenantId=${encodeURIComponent(tenantId)}`,
    { headers: internalIdentityHeaders(request), signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { data?: Record<string, unknown> }).data ?? null;
}

export async function leadsRoutes(server: FastifyInstance) {
  server.addHook("preHandler", moduleAccessGate("contacts"));
  const aclWrite = checkRecordAccess("contact", "write");

  // ── List open leads (contacts with isLead=true, sharing model applied) ────
  const contactsProxy = createProxy({ baseUrl: GRAPH_CORE_URL, stripPrefix: "/api/v1", maskEntity: "contact" });
  server.get("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const qs = request.url.split("?")[1] ?? "";
    const params = new URLSearchParams(qs);
    params.set("isLead", "true");
    (request.raw as { url?: string }).url = `/api/v1/contacts?${params}`;
    await applyListVisibility(request, "contact");
    return contactsProxy(request, reply);
  });

  // ── Convert ───────────────────────────────────────────────────────────────
  server.post("/:id/convert", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid lead id");
    const body = ConvertSchema.safeParse(request.body ?? {});
    if (!body.success) return bad(reply, body.error.issues[0].message);
    const { tenantId } = request.user;
    const b = body.data;

    if (b.ownerId) {
      const ok = await assertAssignee(tenantId, "user", b.ownerId);
      if (!ok) return bad(reply, "Owner is not an active user", "INVALID_OWNER", 422);
    }

    // Validation rules apply to the records conversion creates.
    if (b.createDeal) {
      const failures = await checkValidationRules(tenantId, "deal", {
        name: b.dealName, stage: b.dealStage, value: b.dealValue ?? 0,
        closeDate: b.dealCloseDate, currency: b.currency, ownerId: b.ownerId,
      });
      if (failures.length) return validationFailureReply(reply, failures);
    }

    const res = await internalFetch(
      `${GRAPH_CORE_URL}/contacts/${encodeURIComponent(p.data.id)}/convert?tenantId=${encodeURIComponent(tenantId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalIdentityHeaders(request) },
        body: JSON.stringify(b),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const payload = await res.json().catch(() => ({ success: false, error: { code: "UPSTREAM_ERROR" } }));
    return reply.status(res.status).send(payload);
  });

  // ── Assign one lead now ───────────────────────────────────────────────────
  server.post("/:id/assign", { preHandler: [requireRep, requireCrmWrite, aclWrite] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid lead id");
    const { tenantId } = request.user;
    const contact = await fetchContact(request, p.data.id);
    if (!contact) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    if (contact.isLead !== true) return bad(reply, "Only open leads can be assigned by rules", "NOT_A_LEAD", 409);
    const { userId, ruleId } = await pickAssignee(tenantId, leadFactsFromContact(contact));
    if (userId) await setLeadOwner(tenantId, p.data.id, userId, ruleId);
    return reply.send({ success: true, data: { assignedTo: userId, ruleId } });
  });

  // ── Assignment rules ──────────────────────────────────────────────────────
  server.get("/assignment-rules", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT * FROM lead_assignment_rules WHERE tenant_id = $1 ORDER BY priority, created_at`,
      [request.user.tenantId],
    );
    return reply.send({ success: true, data: rows.map(toRule) });
  });

  server.post("/assignment-rules", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = RuleSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error.issues[0].message);
    const d = parsed.data;
    const { tenantId, sub } = request.user;
    if (!(await assertAssignee(tenantId, d.assignToType, d.assignToId))) {
      return bad(reply, "Assignee does not exist in this workspace", "INVALID_ASSIGNEE", 422);
    }
    const { rows: [row] } = await pool.query(
      `INSERT INTO lead_assignment_rules (tenant_id, name, priority, active, conditions, assign_to_type, assign_to_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenantId, d.name, d.priority, d.active, JSON.stringify(d.conditions), d.assignToType, d.assignToId, sub],
    );
    return reply.status(201).send({ success: true, data: toRule(row) });
  });

  server.patch("/assignment-rules/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const parsed = RuleSchema.partial().safeParse(request.body);
    if (!p.success || !parsed.success) return bad(reply, parsed.success ? "Invalid id" : parsed.error.issues[0].message);
    const d = parsed.data;
    const { tenantId } = request.user;
    const { rows: [cur] } = await pool.query(
      `SELECT * FROM lead_assignment_rules WHERE id = $1 AND tenant_id = $2`, [p.data.id, tenantId],
    );
    if (!cur) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    const type = d.assignToType ?? cur.assign_to_type;
    const target = d.assignToId ?? cur.assign_to_id;
    if ((d.assignToType || d.assignToId) && !(await assertAssignee(tenantId, type, target))) {
      return bad(reply, "Assignee does not exist in this workspace", "INVALID_ASSIGNEE", 422);
    }
    const { rows: [row] } = await pool.query(
      `UPDATE lead_assignment_rules
          SET name = $3, priority = $4, active = $5, conditions = $6,
              assign_to_type = $7, assign_to_id = $8,
              rr_last_user_id = CASE WHEN $8 = assign_to_id THEN rr_last_user_id ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [p.data.id, tenantId, d.name ?? cur.name, d.priority ?? cur.priority, d.active ?? cur.active,
       JSON.stringify(d.conditions ?? cur.conditions), type, target],
    );
    return reply.send({ success: true, data: toRule(row) });
  });

  server.delete("/assignment-rules/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const { rowCount } = await pool.query(
      `DELETE FROM lead_assignment_rules WHERE id = $1 AND tenant_id = $2`, [p.data.id, request.user.tenantId],
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.status(204).send();
  });

  // ── Web-to-lead forms ─────────────────────────────────────────────────────
  server.get("/web-forms", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT * FROM web_to_lead_forms WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [request.user.tenantId],
    );
    return reply.send({ success: true, data: rows.map(toForm) });
  });

  server.post("/web-forms", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = FormSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, parsed.error.issues[0].message);
    const d = parsed.data;
    const formKey = `wtl_${randomBytes(18).toString("base64url")}`;
    const { rows: [row] } = await pool.query(
      `INSERT INTO web_to_lead_forms (tenant_id, name, form_key, allowed_origins, default_source, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [request.user.tenantId, d.name, formKey, d.allowedOrigins, d.defaultSource, d.active, request.user.sub],
    );
    return reply.status(201).send({ success: true, data: toForm(row) });
  });

  server.patch("/web-forms/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    const parsed = FormSchema.partial().safeParse(request.body);
    if (!p.success || !parsed.success) return bad(reply, parsed.success ? "Invalid id" : parsed.error.issues[0].message);
    const d = parsed.data;
    const { rows: [row] } = await pool.query(
      `UPDATE web_to_lead_forms
          SET name = COALESCE($3, name), allowed_origins = COALESCE($4, allowed_origins),
              default_source = COALESCE($5, default_source), active = COALESCE($6, active),
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [p.data.id, request.user.tenantId, d.name ?? null, d.allowedOrigins ?? null, d.defaultSource ?? null, d.active ?? null],
    );
    if (!row) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: toForm(row) });
  });

  server.delete("/web-forms/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const p = IdParam.safeParse(request.params);
    if (!p.success) return bad(reply, "Invalid id");
    const { rowCount } = await pool.query(
      `DELETE FROM web_to_lead_forms WHERE id = $1 AND tenant_id = $2`, [p.data.id, request.user.tenantId],
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.status(204).send();
  });
}

/**
 * Auto-assign a lead created without an owner. Used as an onSend hook on
 * POST /api/v1/contacts so every lead-creation path (UI, API, import) is
 * covered without changing the response contract — the returned body carries
 * the assigned ownerId.
 */
export async function autoAssignOnCreate(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (reply.statusCode !== 201 || typeof payload !== "string") return payload;
  const body = (request.body ?? {}) as { isLead?: boolean; ownerId?: string | null };
  if (body.isLead !== true || body.ownerId) return payload;
  try {
    const parsed = JSON.parse(payload) as { success?: boolean; data?: Record<string, unknown> };
    const contact = parsed.data;
    if (!contact?.id) return payload;
    const tenantId = request.user.tenantId;
    const { userId, ruleId } = await pickAssignee(tenantId, leadFactsFromContact(contact));
    if (!userId) return payload;
    if (await setLeadOwner(tenantId, contact.id as string, userId, ruleId)) {
      contact.ownerId = userId;
      return JSON.stringify(parsed);
    }
  } catch (err) {
    request.log.warn({ err }, "lead_auto_assign_failed");
  }
  return payload;
}
