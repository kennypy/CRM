import type { FastifyInstance } from "fastify";
import { z } from "zod";

const CreateContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  title: z.string().optional(),
  phone: z.string().optional(),
  companyId: z.string().uuid().optional(),
});

export async function contactsRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request, reply) => {
    return reply.send({ success: true, data: [], pagination: { total: 0, page: 1, limit: 20, hasMore: false } });
  });

  fastify.post("/", async (request, reply) => {
    const body = CreateContactSchema.parse(request.body);
    return reply.status(201).send({ success: true, data: { id: crypto.randomUUID(), ...body } });
  });

  fastify.get("/:id", async (request, reply) => {
    return reply.send({ success: true, data: null });
  });

  fastify.patch("/:id", async (request, reply) => {
    const body = CreateContactSchema.partial().parse(request.body);
    const { id } = request.params as { id: string };
    return reply.send({ success: true, data: { id, ...body } });
  });

  fastify.delete("/:id", async (request, reply) => {
    return reply.status(204).send();
  });

  // GET /api/v1/contacts/:id/network — ego graph
  fastify.get("/:id/network", async (request, reply) => {
    return reply.send({ success: true, data: { nodes: [], edges: [] } });
  });
}
