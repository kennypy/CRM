/**
 * Embedded analytics — PUBLIC report serving for signed embed tokens.
 *
 * Registered before the auth hook: the token IS the credential. A token is
 * minted by a manager/admin (POST /api/v1/reports/:id/embed), pins one report
 * + tenant, and expires. The spec is re-sanitized on every request with the
 * creator's role, so later field-permission changes apply to live embeds.
 */

import type { FastifyInstance } from "fastify";
import { readPool, setTenantContext } from "../db";
import { verifyEmbedToken } from "../lib/embed-tokens";
import { executeQuery, sanitizeSpecForRole, QuerySpecSchema } from "./reports";

export async function embedRoutes(server: FastifyInstance) {
  server.get<{ Params: { token: string } }>("/reports/:token", async (request, reply) => {
    const payload = verifyEmbedToken(request.params.token);
    if (!payload) {
      return reply.status(401).send({ success: false, error: { code: "INVALID_EMBED_TOKEN", message: "This embed link is invalid or has expired." } });
    }

    // Public routes skip the auth-derived tenant stamp; set it explicitly so
    // RLS-scoped pools see the right tenant.
    setTenantContext(payload.t);

    const { rows: [report] } = await readPool.query(
      `SELECT id, name, description, spec FROM reports WHERE id = $1 AND tenant_id = $2`,
      [payload.r, payload.t],
    );
    if (!report) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "This report no longer exists." } });
    }

    const specParsed = QuerySpecSchema.safeParse(report.spec);
    if (!specParsed.success) {
      return reply.status(400).send({ success: false, error: { code: "INVALID_SPEC" } });
    }

    const { spec: safeSpec, error } = await sanitizeSpecForRole(specParsed.data, payload.t, payload.o || "manager");
    if (error) {
      return reply.status(403).send({ success: false, error: { code: "FORBIDDEN", message: error } });
    }

    const result = await executeQuery(safeSpec!, payload.t);
    return reply.send({
      success: true,
      data: {
        name: report.name,
        description: report.description,
        spec: safeSpec,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        generatedAt: new Date().toISOString(),
      },
    });
  });
}
