import type { FastifyInstance } from "fastify";

export async function webhookRoutes(fastify: FastifyInstance) {
  // POST /webhooks/zoom — Zoom webhook for meeting transcripts
  fastify.post("/zoom", async (request, reply) => {
    // TODO: verify Zoom webhook signature + publish to Redis Stream
    fastify.log.info({ body: request.body }, "Zoom webhook received");
    return reply.send({ success: true });
  });

  // POST /webhooks/slack — Slack Events API
  fastify.post("/slack", async (request, reply) => {
    const body = request.body as any;
    // Slack URL verification challenge
    if (body?.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }
    // TODO: verify Slack signature + publish to Redis Stream
    return reply.send({ success: true });
  });

  // POST /webhooks/stripe — Stripe billing events
  fastify.post("/stripe", async (request, reply) => {
    // TODO: verify Stripe signature + handle billing events
    return reply.send({ success: true });
  });
}
