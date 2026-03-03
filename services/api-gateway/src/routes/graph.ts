import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

export async function graphRoutes(server: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  // Named graph queries — all proxied to graph-core
  server.get("/stalling-deals",    proxy);
  server.get("/network/:nodeId",   proxy);
  server.get("/intro-path",        proxy);
  server.get("/buying-group/:dealId", proxy);
  server.get("/at-risk-accounts",  proxy);
  server.get("/dark-contacts",     proxy);
}
