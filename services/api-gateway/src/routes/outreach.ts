/**
 * Outreach routes — proxy to the outreach microservice.
 *
 * RBAC:
 *  - Email send / call log / sequence enroll: rep+
 *  - Sequence create/edit:                    manager+
 *  - Dialer configuration:                    admin+ (enforced in outreach service too)
 *  - Read operations:                         all authenticated (read_only+)
 */

import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";
import { requireRep, requireManager, requireAdmin } from "../middleware/rbac";
import { OUTREACH_URL } from "../lib/service-urls";

export async function outreachRoutes(fastify: FastifyInstance) {
  const proxy = createProxy({ baseUrl: OUTREACH_URL, stripPrefix: "/api/v1/outreach" });

  // ── Email ──────────────────────────────────────────────────────────────────
  fastify.get("/email/threads",                   proxy);
  fastify.get("/email/threads/:id/messages",      proxy);
  fastify.post("/email/send",  { preHandler: [requireRep] }, proxy);
  fastify.post("/email/suggest", { preHandler: [requireRep] }, proxy);
  // Unsubscribe is public — handled directly in outreach service (no proxy auth needed)

  // ── Sequences ──────────────────────────────────────────────────────────────
  fastify.get( "/sequences",                      proxy);
  fastify.post("/sequences",    { preHandler: [requireManager] }, proxy);
  fastify.get( "/sequences/:id",                  proxy);
  fastify.patch("/sequences/:id", { preHandler: [requireManager] }, proxy);
  fastify.patch("/sequences/:id/status", { preHandler: [requireManager] }, proxy);
  fastify.delete("/sequences/:id", { preHandler: [requireManager] }, proxy);

  fastify.get( "/sequences/:id/steps",            proxy);
  fastify.post("/sequences/:id/steps", { preHandler: [requireManager] }, proxy);
  fastify.delete("/sequences/:id/steps/:stepId", { preHandler: [requireManager] }, proxy);

  fastify.get( "/sequences/:id/enrollments",      proxy);
  fastify.post("/sequences/:id/enroll", { preHandler: [requireRep] }, proxy);
  fastify.post("/sequences/:id/enrollments/:enrollId/pause",  { preHandler: [requireRep] }, proxy);
  fastify.post("/sequences/:id/enrollments/:enrollId/resume", { preHandler: [requireRep] }, proxy);

  fastify.get( "/sequences/:id/analytics",        proxy);

  // ── Calls ──────────────────────────────────────────────────────────────────
  fastify.get( "/calls",                          proxy);
  fastify.post("/calls",  { preHandler: [requireRep] }, proxy);
  fastify.patch("/calls/:id", { preHandler: [requireRep] }, proxy);
  fastify.get( "/calls/:id/recording",            proxy);
  fastify.post("/calls/token", { preHandler: [requireRep] }, proxy);

  // ── Dialers ────────────────────────────────────────────────────────────────
  fastify.get("/dialers/config",                  proxy);
  fastify.put("/dialers/native",    { preHandler: [requireAdmin] }, proxy);
  fastify.delete("/dialers/native", { preHandler: [requireAdmin] }, proxy);
  fastify.post("/dialers/iframe",   { preHandler: [requireAdmin] }, proxy);
  fastify.delete("/dialers/iframe/:id", { preHandler: [requireAdmin] }, proxy);
  fastify.patch("/dialers/active",  { preHandler: [requireRep] },   proxy);
}
