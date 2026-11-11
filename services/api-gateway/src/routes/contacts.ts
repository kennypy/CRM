import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { blockReadOnlyFields } from "../middleware/field-access";
import { checkRecordAccess } from "../middleware/record-access";
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

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite, aclDelete, holdGuard] }, proxy);
}
