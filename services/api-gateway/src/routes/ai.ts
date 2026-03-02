import type { FastifyInstance } from "fastify";
import { z } from "zod";

const NLCommandSchema = z.object({
  command: z.string().min(1).max(1000),
  context: z.object({
    currentPage: z.string().optional(),
    selectedEntityId: z.string().optional(),
    selectedEntityType: z.string().optional(),
  }).optional(),
});

export async function aiRoutes(fastify: FastifyInstance) {
  // POST /api/v1/ai/nl — Natural language command (streaming SSE)
  fastify.post("/nl", async (request, reply) => {
    const body = NLCommandSchema.parse(request.body);

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");

    const send = (chunk: object) => {
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    try {
      // TODO: Forward to ai-engine service with streaming
      // For now, simulate streaming response
      send({ type: "thinking", content: "Analyzing your request…" });

      await new Promise((r) => setTimeout(r, 300));

      send({ type: "thinking", content: "Querying the graph…" });

      await new Promise((r) => setTimeout(r, 400));

      send({
        type: "result",
        content: `Processed: "${body.command}". AI Engine integration pending.`,
      });

    } catch (err) {
      send({ type: "error", content: "Failed to process command" });
    } finally {
      reply.raw.end();
    }
  });

  // GET /api/v1/ai/review-queue
  fastify.get("/review-queue", async (request, reply) => {
    const query = request.query as { status?: string; limit?: string; cursor?: string };
    // TODO: proxy to ai-engine service
    return reply.send({ success: true, data: [], pagination: { total: 0, hasMore: false } });
  });

  // POST /api/v1/ai/review-queue/:id/approve
  fastify.post("/review-queue/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    // TODO: proxy to ai-engine service
    return reply.send({ success: true, data: { id, status: "approved" } });
  });

  // POST /api/v1/ai/review-queue/:id/reject
  fastify.post("/review-queue/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ reason: z.string().optional() }).parse(request.body);
    // TODO: proxy to ai-engine service
    return reply.send({ success: true, data: { id, status: "rejected", ...body } });
  });

  // GET /api/v1/ai/explain/:entityType/:entityId/:field
  fastify.get("/explain/:entityType/:entityId/:field", async (request, reply) => {
    const { entityType, entityId, field } = request.params as Record<string, string>;
    // TODO: proxy to ai-engine service — returns provenance for this field
    return reply.send({
      success: true,
      data: {
        entityType,
        entityId,
        field,
        explanation: "This field was extracted from an email sent on 2024-12-01.",
        evidence: "…excerpt from source…",
        confidence: 0.92,
        source: "gmail",
        extractedAt: new Date().toISOString(),
      },
    });
  });
}
