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

export async function companiesRoutes(server: FastifyInstance) {
  // Custom-role permission grid (Settings → Users → Profiles)
  server.addHook("preHandler", moduleAccessGate("companies"));
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1", maskEntity: "company" });
  const blockRO = blockReadOnlyFields("company");
  // Record-level ACLs (record_permissions / record_permission_defaults) —
  // previously configurable in the UI but never enforced.
  const aclRead   = checkRecordAccess("company", "read");
  const aclWrite  = checkRecordAccess("company", "write");
  const aclDelete = checkRecordAccess("company", "delete");
  const holdGuard = blockLegalHold("company");
  const rules     = enforceValidationRules("company");
  const visibility = async (request: Parameters<typeof applyListVisibility>[0]) =>
    applyListVisibility(request, "company");

  // Read: all authenticated users
  server.get("/",                       { preHandler: [requireCrmRead, visibility] }, proxy);
  server.get("/:id", { preHandler: [requireCrmRead, aclRead] }, proxy);
  server.get("/by-domain/:domain",      { preHandler: [requireCrmRead] }, proxy);
  server.get("/:id/detail", { preHandler: [requireCrmRead, aclRead] }, proxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep, requireCrmWrite, blockRO, rules] },     proxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite, aclWrite, blockRO, rules] },     proxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite, aclDelete, holdGuard] }, proxy);
}
