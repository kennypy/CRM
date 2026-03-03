import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

export async function companiesRoutes(server: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });
  server.get("/",       proxy);
  server.post("/",      proxy);
  server.get("/:id",    proxy);
  server.patch("/:id",  proxy);
  server.delete("/:id", proxy);
}
