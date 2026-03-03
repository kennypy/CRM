import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

export async function dealsRoutes(server: FastifyInstance) {
  const graphProxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  server.get("/",       graphProxy);
  server.post("/",      graphProxy);
  server.get("/:id",    graphProxy);
  server.patch("/:id",  graphProxy);
  server.delete("/:id", graphProxy);
  server.get("/:id/timeline", graphProxy);

  // Reality Score: proxy to graph-core's deterministic scoring engine.
  // graph-core computes the score, writes a snapshot, and updates the Deal node.
  // No AI engine involved — every score is explainable from evidence.
  server.get("/:id/reality-score", graphProxy);
}
