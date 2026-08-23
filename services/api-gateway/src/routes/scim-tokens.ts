/**
 * SCIM provisioning token management — admin-only.
 *
 * GET    /api/v1/scim-tokens      — list the workspace's SCIM tokens (no secrets)
 * POST   /api/v1/scim-tokens      — create a token (raw value shown once)
 * DELETE /api/v1/scim-tokens/:id  — revoke a token
 *
 * The tokens authenticate identity providers against the SCIM 2.0 endpoint
 * (${APP_URL}/scim/v2, proxied to the auth service). Only a SHA-256 hash is
 * stored — same model as API keys.
 */

import { createHash, randomBytes } from "crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { denyApiKeys } from "../middleware/scope";
import { requireAdmin } from "../middleware/rbac";

const TOKEN_PREFIX = "scim_";

const CreateTokenSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function scimTokensRoutes(server: FastifyInstance) {
  server.addHook("preHandler", denyApiKeys);
  server.addHook("preHandler", requireAdmin);

  server.get("/", async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, name, token_prefix, created_at, last_used_at
         FROM scim_tokens
        WHERE tenant_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return reply.send({ success: true, data: rows });
  });

  server.post("/", async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const parsed = CreateTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const rawToken = TOKEN_PREFIX + randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const tokenPrefix = rawToken.slice(0, 10);

    const { rows: [token] } = await pool.query(
      `INSERT INTO scim_tokens (tenant_id, created_by, name, token_hash, token_prefix)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, token_prefix, created_at, last_used_at`,
      [tenantId, userId, parsed.data.name, tokenHash, tokenPrefix],
    );

    server.log.info({ tenantId, userId, tokenId: token.id }, "scim_token.created");

    // Return the raw token ONCE — it's never retrievable again.
    return reply.status(201).send({ success: true, data: { ...token, token: rawToken } });
  });

  server.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows: [token] } = await pool.query(
      `UPDATE scim_tokens SET revoked_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [id, tenantId],
    );
    if (!token) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    server.log.info({ tenantId, tokenId: id }, "scim_token.revoked");
    return reply.status(204).send();
  });
}
