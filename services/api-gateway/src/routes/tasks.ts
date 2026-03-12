/**
 * Tasks proxy — forwards to graph-core /tasks.
 */

import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

export async function tasksRoutes(server: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1/tasks" });

  server.get("/",    { preHandler: [requireCrmRead] }, proxy);
  server.post("/",   { preHandler: [requireRep, requireCrmWrite] }, proxy);
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite] }, proxy);
  server.delete("/:id", { preHandler: [requireRep, requireCrmWrite] }, proxy);
}
