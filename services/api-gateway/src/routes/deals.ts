import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { blockReadOnlyFields } from "../middleware/field-access";
import { checkRecordAccess } from "../middleware/record-access";
import { blockLegalHold } from "../middleware/legal-hold-guard";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";
import { moduleAccessGate } from "../middleware/module-access";

export async function dealsRoutes(server: FastifyInstance) {
  // Custom-role permission grid (Settings → Users → Profiles)
  server.addHook("preHandler", moduleAccessGate("deals"));
  const graphProxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1", maskEntity: "deal" });
  const blockRO = blockReadOnlyFields("deal");
  // Record-level ACLs (record_permissions / record_permission_defaults) —
  // previously configurable in the UI but never enforced.
  const aclRead   = checkRecordAccess("deal", "read");
  const aclWrite  = checkRecordAccess("deal", "write");
  const aclDelete = checkRecordAccess("deal", "delete");
  const holdGuard = blockLegalHold("deal");

  // Read: all authenticated users
  server.get("/",                  { preHandler: [requireCrmRead] }, graphProxy);
  server.get("/:id", { preHandler: [requireCrmRead, aclRead] }, graphProxy);
  server.get("/:id/timeline", { preHandler: [requireCrmRead, aclRead] }, graphProxy);
  server.get("/:id/reality-score", { preHandler: [requireCrmRead, aclRead] }, graphProxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep, requireCrmWrite, blockRO] },     graphProxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite, aclWrite, blockRO] },     graphProxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite, aclDelete, holdGuard] }, graphProxy);
}
