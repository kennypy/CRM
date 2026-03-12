import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireRep, requireManager } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

export async function activitiesRoutes(fastify: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  // Read: all authenticated users (read_only+)
  fastify.get("/",      { preHandler: [requireCrmRead] }, proxy);
  fastify.get("/:id",   { preHandler: [requireCrmRead] }, proxy);

  // Write: rep+
  fastify.post("/",     { preHandler: [requireRep, requireCrmWrite] },     proxy);
  fastify.patch("/:id", { preHandler: [requireRep, requireCrmWrite] },     proxy);

  // Delete: manager+
  fastify.delete("/:id", { preHandler: [requireManager, requireCrmWrite] }, proxy);
}
