import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireManager, requireRep } from "../middleware/rbac";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

export async function dealsRoutes(server: FastifyInstance) {
  const graphProxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  // Read: all authenticated users
  server.get("/",                  graphProxy);
  server.get("/:id",               graphProxy);
  server.get("/:id/timeline",      graphProxy);
  server.get("/:id/reality-score", graphProxy);

  // Write: rep+
  server.post("/",     { preHandler: [requireRep] },     graphProxy);
  server.patch("/:id", { preHandler: [requireRep] },     graphProxy);

  // Delete: manager+
  server.delete("/:id", { preHandler: [requireManager] }, graphProxy);
}
