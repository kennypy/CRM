import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { blockReadOnlyFields } from "../middleware/field-access";
import { checkRecordAccess } from "../middleware/record-access";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";
import { moduleAccessGate } from "../middleware/module-access";

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

  // Read: all authenticated users (read_only+)
  server.get("/",            { preHandler: [requireCrmRead] }, proxy);
  server.get("/:id", { preHandler: [requireCrmRead, aclRead] }, proxy);
  server.get("/:id/network", { preHandler: [requireCrmRead, aclRead] }, proxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep, requireCrmWrite, blockRO] },     proxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite, aclWrite, blockRO] },     proxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite, aclDelete] }, proxy);
}
