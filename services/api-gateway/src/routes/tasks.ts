/**
 * Tasks proxy — forwards to graph-core /tasks.
 */

import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireRep } from "../middleware/rbac";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

export async function tasksRoutes(server: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1/tasks" });

  server.get("/",    proxy);
  server.post("/",   { preHandler: [requireRep] }, proxy);
  server.patch("/:id", { preHandler: [requireRep] }, proxy);
  server.delete("/:id", { preHandler: [requireRep] }, proxy);
}
