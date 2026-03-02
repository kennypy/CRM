import type { FastifyInstance } from "fastify";

export async function activitiesRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (_, reply) =>
    reply.send({ success: true, data: [], pagination: { total: 0, page: 1, limit: 50, hasMore: false } })
  );
  fastify.post("/", async (request, reply) =>
    reply.status(201).send({ success: true, data: { id: crypto.randomUUID(), ...(request.body as object) } })
  );
}
