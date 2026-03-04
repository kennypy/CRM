import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireRep, requireManager } from "../middleware/rbac";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

export async function activitiesRoutes(fastify: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  // Read: all authenticated users (read_only+)
  fastify.get("/",      proxy);
  fastify.get("/:id",   proxy);

  // Write: rep+
  fastify.post("/",     { preHandler: [requireRep] },     proxy);
  fastify.patch("/:id", { preHandler: [requireRep] },     proxy);

  // Delete: manager+
  fastify.delete("/:id", { preHandler: [requireManager] }, proxy);
}
