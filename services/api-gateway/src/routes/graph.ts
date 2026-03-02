import type { FastifyInstance } from "fastify";
import { z } from "zod";

const GraphQuerySchema = z.object({
  queryName: z.string(),
  params: z.record(z.unknown()).optional(),
});

export async function graphRoutes(fastify: FastifyInstance) {
  // POST /api/v1/graph/query — run named graph query
  fastify.post("/query", async (request, reply) => {
    const body = GraphQuerySchema.parse(request.body);
    // TODO: proxy to graph-core service
    return reply.send({ success: true, data: { nodes: [], edges: [] } });
  });

  // GET /api/v1/graph/network/:id — ego network
  fastify.get("/network/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const depth = parseInt((request.query as any).depth ?? "2", 10);
    // TODO: proxy to graph-core service
    return reply.send({ success: true, data: { rootId: id, depth, nodes: [], edges: [] } });
  });

  // GET /api/v1/graph/path — shortest intro path
  fastify.get("/path", async (request, reply) => {
    const { from, to } = request.query as { from: string; to: string };
    // TODO: proxy to graph-core service — Cypher shortest path query
    return reply.send({ success: true, data: { from, to, path: [], length: 0 } });
  });
}
