import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

export async function activitiesRoutes(fastify: FastifyInstance) {
  const proxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });

  fastify.get("/",       proxy);
  fastify.post("/",      proxy);
  fastify.get("/:id",    proxy);
  fastify.patch("/:id",  proxy);
  fastify.delete("/:id", proxy);
}
