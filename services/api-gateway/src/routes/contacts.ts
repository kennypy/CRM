import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

export async function contactsRoutes(server: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  // Read: all authenticated users (read_only+)
  server.get("/",            proxy);
  server.get("/:id",         proxy);
  server.get("/:id/network", proxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep] },     proxy);
  server.patch("/:id", { preHandler: [requireRep] },     proxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager] }, proxy);
}
