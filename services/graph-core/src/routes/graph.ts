/**
 * Graph-specific endpoints — queries that only make sense in a graph model.
 * These are the differentiating features vs. SQL-only CRMs.
 */

import type { FastifyInstance } from "fastify";
import {
  getStallingDeals,
  getEgoNetwork,
  getIntroPath,
  getBuyingGroup,
  getAtRiskAccounts,
  getDarkContacts,
} from "../queries/graph-queries";

export async function graphRoutes(server: FastifyInstance) {
  /**
   * GET /graph/stalling-deals?tenantId=&daysSilent=7
   * Deals with no activity in N days — a live query Salesforce can't do without custom reports.
   */
  server.get("/stalling-deals", async (request, reply) => {
    const { tenantId, daysSilent } = request.query as Record<string, string>;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getStallingDeals(tenantId, parseInt(daysSilent ?? "7", 10));
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/network/:nodeId?tenantId=&depth=2
   * Ego network — all nodes within N hops.
   */
  server.get("/network/:nodeId", async (request, reply) => {
    const { nodeId } = request.params as { nodeId: string };
    const { tenantId, depth } = request.query as Record<string, string>;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getEgoNetwork(nodeId, parseInt(depth ?? "2", 10));
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/intro-path?from=:id&to=:id
   * Shortest introduction path via KNOWS edges.
   * "Who in our network knows the CTO of Acme?"
   */
  server.get("/intro-path", async (request, reply) => {
    const { from, to } = request.query as { from: string; to: string };
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: { code: "MISSING_PARAMS", message: "from and to are required" } });
    }
    const rows = await getIntroPath(from, to);
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/buying-group/:dealId
   * All stakeholders with roles and influence scores for a deal.
   */
  server.get("/buying-group/:dealId", async (request, reply) => {
    const { dealId } = request.params as { dealId: string };
    const rows = await getBuyingGroup(dealId);
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/at-risk-accounts?tenantId=
   * Accounts where sentiment has declined or activity has dropped.
   */
  server.get("/at-risk-accounts", async (request, reply) => {
    const { tenantId } = request.query as { tenantId: string };
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getAtRiskAccounts(tenantId);
    return reply.send({ success: true, data: rows });
  });

  /**
   * GET /graph/dark-contacts?tenantId=&daysDark=7
   * Contacts who haven't responded in N days.
   */
  server.get("/dark-contacts", async (request, reply) => {
    const { tenantId, daysDark } = request.query as Record<string, string>;
    if (!tenantId) return reply.status(400).send({ success: false, error: { code: "MISSING_TENANT" } });
    const rows = await getDarkContacts(tenantId, parseInt(daysDark ?? "7", 10));
    return reply.send({ success: true, data: rows });
  });
}
