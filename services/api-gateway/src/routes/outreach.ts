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
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { OUTREACH_URL } from "../lib/service-urls";

export async function outreachRoutes(fastify: FastifyInstance) {
  const proxy = createProxy({ baseUrl: OUTREACH_URL, stripPrefix: "/api/v1/outreach" });

  // ── Email ──────────────────────────────────────────────────────────────────
  fastify.get("/email/threads",                   { preHandler: [requireCrmRead] }, proxy);
  fastify.get("/email/threads/:id/messages",      { preHandler: [requireCrmRead] }, proxy);
  fastify.post("/email/send",  { preHandler: [requireRep, requireCrmWrite] }, proxy);
  fastify.post("/email/suggest", { preHandler: [requireRep, requireCrmWrite] }, proxy);
  // Unsubscribe is public — handled directly in outreach service (no proxy auth needed)

  // ── Sequences ──────────────────────────────────────────────────────────────
  fastify.get( "/sequences",                      { preHandler: [requireCrmRead] }, proxy);
  fastify.post("/sequences",    { preHandler: [requireManager, requireCrmWrite] }, proxy);
  fastify.get( "/sequences/:id",                  { preHandler: [requireCrmRead] }, proxy);
  fastify.patch("/sequences/:id", { preHandler: [requireManager, requireCrmWrite] }, proxy);
  fastify.patch("/sequences/:id/status", { preHandler: [requireManager, requireCrmWrite] }, proxy);
  fastify.delete("/sequences/:id", { preHandler: [requireManager, requireCrmWrite] }, proxy);

  fastify.get( "/sequences/:id/steps",            { preHandler: [requireCrmRead] }, proxy);
  fastify.post("/sequences/:id/steps", { preHandler: [requireManager, requireCrmWrite] }, proxy);
  fastify.delete("/sequences/:id/steps/:stepId", { preHandler: [requireManager, requireCrmWrite] }, proxy);

  fastify.get( "/sequences/:id/enrollments",      { preHandler: [requireCrmRead] }, proxy);
  fastify.post("/sequences/:id/enroll", { preHandler: [requireRep, requireCrmWrite] }, proxy);
  fastify.post("/sequences/:id/enrollments/:enrollId/pause",  { preHandler: [requireRep, requireCrmWrite] }, proxy);
  fastify.post("/sequences/:id/enrollments/:enrollId/resume", { preHandler: [requireRep, requireCrmWrite] }, proxy);

  fastify.get( "/sequences/:id/analytics",        { preHandler: [requireCrmRead] }, proxy);

  // ── Calls ──────────────────────────────────────────────────────────────────
  fastify.get( "/calls",                          { preHandler: [requireCrmRead] }, proxy);
  fastify.post("/calls",  { preHandler: [requireRep, requireCrmWrite] }, proxy);
  fastify.patch("/calls/:id", { preHandler: [requireRep, requireCrmWrite] }, proxy);
  fastify.get( "/calls/:id/recording",            { preHandler: [requireCrmRead] }, proxy);
  fastify.post("/calls/token", { preHandler: [requireRep, requireCrmWrite] }, proxy);

  // ── Dialers ────────────────────────────────────────────────────────────────
  fastify.get("/dialers/config",                  { preHandler: [requireCrmRead] }, proxy);
  fastify.put("/dialers/native",    { preHandler: [requireAdmin, requireCrmWrite] }, proxy);
  fastify.delete("/dialers/native", { preHandler: [requireAdmin, requireCrmWrite] }, proxy);
  fastify.post("/dialers/iframe",   { preHandler: [requireAdmin, requireCrmWrite] }, proxy);
  fastify.delete("/dialers/iframe/:id", { preHandler: [requireAdmin, requireCrmWrite] }, proxy);
  fastify.patch("/dialers/active",  { preHandler: [requireRep, requireCrmWrite] },   proxy);
}
