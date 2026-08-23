/**
 * Internal-only routes — called by other services (auth), never exposed to the
 * public internet. Protected by the global service-token hook in index.ts.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { servicePool } from "../db/pool";
import { seedSampleData } from "../db/sample-data";

const SampleDataSchema = z.object({
  tenantId:    z.string().uuid(),
  ownerUserId: z.string().uuid(),
});

export async function internalRoutes(server: FastifyInstance) {
  /**
   * POST /internal/sample-data
   * Seed the shared CRM sample data into a (sandbox) tenant. Called by the
   * auth service once a sandbox registration verifies its email. Idempotent
   * per tenant in effect: IDs are random per call, so this is intended to run
   * once — the auth service only calls it on first verification.
   */
  server.post("/sample-data", async (request, reply) => {
    const parsed = SampleDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }
    const { tenantId, ownerUserId } = parsed.data;

    const client = await servicePool.connect();
    try {
      const outcome = await seedSampleData(client, {
        tenantId,
        ownerPrimary: ownerUserId,
        ownerSecondary: ownerUserId,
        log: (msg) => request.log.info({ tenantId }, `sample-data: ${msg}`),
      });
      request.log.info({ tenantId, counts: outcome.actual }, "sample_data.seeded");
      return reply.send({ success: true, data: { counts: outcome.actual } });
    } catch (err: any) {
      request.log.error({ tenantId, err: err.message }, "sample_data.failed");
      return reply.status(500).send({
        success: false,
        error: { code: "SEED_FAILED", message: err.message },
      });
    } finally {
      client.release();
    }
  });
}
