import type { FastifyInstance } from "fastify";
import { z } from "zod";

const CreateCompanySchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  industry: z.string().optional(),
  headcount: z.number().int().positive().optional(),
  tier: z.enum(["smb", "mid_market", "enterprise"]).optional(),
});

export async function companiesRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (_, reply) =>
    reply.send({ success: true, data: [], pagination: { total: 0, page: 1, limit: 20, hasMore: false } })
  );

  fastify.post("/", async (request, reply) => {
    const body = CreateCompanySchema.parse(request.body);
    return reply.status(201).send({ success: true, data: { id: crypto.randomUUID(), ...body } });
  });

  fastify.get("/:id", async (request, reply) => reply.send({ success: true, data: null }));

  fastify.patch("/:id", async (request, reply) => {
    const body = CreateCompanySchema.partial().parse(request.body);
    const { id } = request.params as { id: string };
    return reply.send({ success: true, data: { id, ...body } });
  });

  fastify.delete("/:id", async (_, reply) => reply.status(204).send());
}
