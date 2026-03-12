import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

export async function companiesRoutes(server: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  // Read: all authenticated users
  server.get("/",                       { preHandler: [requireCrmRead] }, proxy);
  server.get("/:id",                    { preHandler: [requireCrmRead] }, proxy);
  server.get("/by-domain/:domain",      { preHandler: [requireCrmRead] }, proxy);
  server.get("/:id/detail",             { preHandler: [requireCrmRead] }, proxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep, requireCrmWrite] },     proxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite] },     proxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite] }, proxy);
}
