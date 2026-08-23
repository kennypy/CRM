/**
 * GET /api/v1/capabilities — the instance capability manifest.
 *
 * Tells the web app which product capabilities this deployment actually has
 * (see lib/instance-capabilities.ts) so it can hide or visibly disable
 * features whose backing services are absent, instead of rendering them and
 * failing at runtime. Derived from configuration; no per-request probing.
 */

import type { FastifyInstance } from "fastify";
import { getCapabilityManifest } from "../lib/instance-capabilities";

export async function capabilitiesRoutes(server: FastifyInstance) {
  server.get("/", async (_request, reply) => {
    return reply.send({ success: true, data: getCapabilityManifest() });
  });
}
