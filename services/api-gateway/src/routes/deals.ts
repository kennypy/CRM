import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { blockReadOnlyFields } from "../middleware/field-access";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

export async function dealsRoutes(server: FastifyInstance) {
  const graphProxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1", maskEntity: "deal" });
  const blockRO = blockReadOnlyFields("deal");

  // Read: all authenticated users
  server.get("/",                  { preHandler: [requireCrmRead] }, graphProxy);
  server.get("/:id",               { preHandler: [requireCrmRead] }, graphProxy);
  server.get("/:id/timeline",      { preHandler: [requireCrmRead] }, graphProxy);
  server.get("/:id/reality-score", { preHandler: [requireCrmRead] }, graphProxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep, requireCrmWrite, blockRO] },     graphProxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite, blockRO] },     graphProxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite] }, graphProxy);
}
