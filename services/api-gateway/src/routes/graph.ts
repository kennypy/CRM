import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireCrmRead } from "../middleware/scope";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";

export async function graphRoutes(server: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  // Named graph queries — all proxied to graph-core
  server.get("/stalling-deals",    { preHandler: [requireCrmRead] }, proxy);
  server.get("/network/:nodeId",   { preHandler: [requireCrmRead] }, proxy);
  server.get("/intro-path",        { preHandler: [requireCrmRead] }, proxy);
  server.get("/buying-group/:dealId", { preHandler: [requireCrmRead] }, proxy);
  server.get("/at-risk-accounts",  { preHandler: [requireCrmRead] }, proxy);
  server.get("/dark-contacts",     { preHandler: [requireCrmRead] }, proxy);
}
