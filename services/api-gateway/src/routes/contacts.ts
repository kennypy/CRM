import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { blockReadOnlyFields } from "../middleware/field-access";
import { checkRecordAccess, hasRecordAccess } from "../middleware/record-access";
import { entityHold } from "../lib/legal-hold";
import { pool } from "../db";
import { internalFetch, internalIdentityHeaders } from "../lib/internal-fetch";
import { blockLegalHold } from "../middleware/legal-hold-guard";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";
import { moduleAccessGate } from "../middleware/module-access";
import { enforceValidationRules } from "../lib/validation-rules";
import { applyListVisibility } from "../lib/list-visibility";
import { autoAssignOnCreate } from "./leads";

export async function contactsRoutes(server: FastifyInstance) {
  // Custom-role permission grid (Settings → Users → Profiles)
  server.addHook("preHandler", moduleAccessGate("contacts"));
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1", maskEntity: "contact" });
  const blockRO = blockReadOnlyFields("contact");
  // Record-level ACLs (record_permissions / record_permission_defaults) —
  // previously configurable in the UI but never enforced.
  const aclRead   = checkRecordAccess("contact", "read");
  const aclWrite  = checkRecordAccess("contact", "write");
  const aclDelete = checkRecordAccess("contact", "delete");
  const holdGuard = blockLegalHold("contact");
  const rules     = enforceValidationRules("contact");
  const visibility = async (request: Parameters<typeof applyListVisibility>[0]) =>
    applyListVisibility(request, "contact");

  // Read: all authenticated users (read_only+)
  server.get("/",            { preHandler: [requireCrmRead, visibility] }, proxy);
  server.get("/:id", { preHandler: [requireCrmRead, aclRead] }, proxy);
  server.get("/:id/network", { preHandler: [requireCrmRead, aclRead] }, proxy);

  // Write: rep+
  // New leads without an owner are routed by lead assignment rules.
  server.post("/",     { preHandler: [requireRep, requireCrmWrite, blockRO, rules], onSend: autoAssignOnCreate },     proxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite, aclWrite, blockRO, rules] },     proxy);

  // Merge duplicates: manager+ (it deletes the duplicates). Needs write on the
  // survivor, delete on every duplicate, and no legal hold on any duplicate.
  server.post("/merge", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const body = (request.body ?? {}) as { primaryId?: unknown; secondaryIds?: unknown };
    const primaryId = typeof body.primaryId === "string" ? body.primaryId : "";
    const secondaryIds = Array.isArray(body.secondaryIds) ? body.secondaryIds.filter((x): x is string => typeof x === "string") : [];
    const { tenantId, sub, role } = request.user;
    if (!primaryId || !secondaryIds.length) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: "primaryId and secondaryIds are required" } });
    }
    if (!(await hasRecordAccess(tenantId, sub, role, "contact", primaryId, "write"))) {
      return reply.status(403).send({ success: false, error: { code: "RECORD_ACCESS_DENIED", message: "No write access to the surviving contact" } });
    }
    for (const id of secondaryIds) {
      if (!(await hasRecordAccess(tenantId, sub, role, "contact", id, "delete"))) {
        return reply.status(403).send({ success: false, error: { code: "RECORD_ACCESS_DENIED", message: "No delete access to a duplicate" } });
      }
      const hold = await entityHold(pool, tenantId, "contact", id);
      if (hold) {
        return reply.status(403).send({ success: false, error: { code: "LEGAL_HOLD", message: `A duplicate is under the legal hold "${hold}" and cannot be merged away.` } });
      }
    }
    const res = await internalFetch(`${GRAPH_CORE}/contacts/merge?tenantId=${encodeURIComponent(tenantId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalIdentityHeaders(request) },
      body: JSON.stringify({ primaryId, secondaryIds }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await res.json().catch(() => ({ success: false, error: { code: "UPSTREAM_ERROR" } }));
    return reply.status(res.status).send(payload);
  });

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite, aclDelete, holdGuard] }, proxy);
}
