import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { blockReadOnlyFields } from "../middleware/field-access";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

export async function contactsRoutes(server: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1", maskEntity: "contact" });
  const blockRO = blockReadOnlyFields("contact");

  // Read: all authenticated users (read_only+)
  server.get("/",            { preHandler: [requireCrmRead] }, proxy);
  server.get("/:id",         { preHandler: [requireCrmRead] }, proxy);
  server.get("/:id/network", { preHandler: [requireCrmRead] }, proxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep, requireCrmWrite, blockRO] },     proxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite, blockRO] },     proxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite] }, proxy);
}
