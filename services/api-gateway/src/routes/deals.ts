import type { FastifyInstance } from "fastify";
import { z } from "zod";

const CreateDealSchema = z.object({
  name: z.string().min(1),
  stage: z.enum(["lead", "qualified", "discovery", "proposal", "negotiation", "closed_won", "closed_lost"]),
  value: z.number().min(0),
  currency: z.string().default("USD"),
  closeDate: z.string().datetime().optional(),
  companyId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
});

const UpdateDealSchema = CreateDealSchema.partial();

export async function dealsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/deals
  fastify.get("/", async (request, reply) => {
    const query = request.query as Record<string, string>;
    // TODO: proxy to graph-core service
    return reply.send({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, limit: 20, hasMore: false },
    });
  });

  // POST /api/v1/deals
  fastify.post("/", async (request, reply) => {
    const body = CreateDealSchema.parse(request.body);
    // TODO: proxy to graph-core service
    return reply.status(201).send({ success: true, data: { id: crypto.randomUUID(), ...body } });
  });

  // GET /api/v1/deals/:id
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    // TODO: proxy to graph-core service
    return reply.send({ success: true, data: null });
  });

  // PATCH /api/v1/deals/:id
  fastify.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateDealSchema.parse(request.body);
    // TODO: proxy to graph-core service
    return reply.send({ success: true, data: { id, ...body } });
  });

  // GET /api/v1/deals/:id/reality-score
  fastify.get("/:id/reality-score", async (request, reply) => {
    const { id } = request.params as { id: string };
    // TODO: proxy to ai-engine service
    return reply.send({
      success: true,
      data: {
        score: 72,
        trend: "down",
        trendDelta: -8,
        explanation: "No activity in 6 days. Legal objection raised in last meeting. Budget confirmed.",
        factors: [
          { name: "Recency of activity", weight: 0.3, score: 40, evidence: "Last email 6 days ago" },
          { name: "Engagement breadth", weight: 0.25, score: 80, evidence: "4 of 5 stakeholders engaged" },
          { name: "Sentiment trend", weight: 0.2, score: 65, evidence: "Legal concern raised" },
          { name: "Close date proximity", weight: 0.15, score: 90, evidence: "12 days to close date" },
          { name: "Budget confirmed", weight: 0.1, score: 100, evidence: "Budget email 14 days ago" },
        ],
        lastCalculatedAt: new Date().toISOString(),
      },
    });
  });

  // GET /api/v1/deals/:id/timeline
  fastify.get("/:id/timeline", async (request, reply) => {
    const { id } = request.params as { id: string };
    // TODO: proxy to graph-core service
    return reply.send({ success: true, data: [] });
  });

  // DELETE /api/v1/deals/:id
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    // TODO: soft delete via graph-core service
    return reply.status(204).send();
  });
}
