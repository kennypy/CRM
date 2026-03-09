/**
 * API key management — server-to-server authentication.
 *
 * GET    /api/v1/api-keys          — list tenant's API keys (no secrets)
 * POST   /api/v1/api-keys          — create a new API key (secret shown once)
 * DELETE /api/v1/api-keys/:id      — revoke an API key
 *
 * API keys authenticate via the Authorization header:
 *   Authorization: ApiKey nxc_<raw_key>
 *
 * The raw key is never stored — only a SHA-256 hash is kept in the DB.
 * The auth middleware checks for the ApiKey scheme before falling back to JWT.
 */

import { createHash, randomBytes } from "crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";

const KEY_PREFIX = "nxc_";

const VALID_SCOPES = ["crm:read", "crm:write", "ai:read", "ai:write"] as const;

const CreateKeySchema = z.object({
  name:       z.string().min(1).max(100),
  scopes:     z.array(z.enum(VALID_SCOPES)).min(1).default(["crm:read"]),
  expires_at: z.string().datetime().optional(),
});

export async function apiKeysRoutes(server: FastifyInstance) {
  // GET /api/v1/api-keys
  server.get("/", async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT id, name, key_prefix, scopes, last_used_at, expires_at, is_active, created_at
         FROM api_keys
        WHERE tenant_id = $1 AND is_active = TRUE
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return reply.send({ success: true, data: rows });
  });

  // POST /api/v1/api-keys
  server.post("/", async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const parsed = CreateKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    // Generate a cryptographically random key.
    const rawKey   = KEY_PREFIX + randomBytes(40).toString("hex");
    const keyHash  = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12); // "nxc_" + first 8 random chars

    const { rows: [key] } = await pool.query(
      `INSERT INTO api_keys (tenant_id, created_by, name, key_hash, key_prefix, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, key_prefix, scopes, expires_at, is_active, created_at`,
      [
        tenantId, userId,
        parsed.data.name,
        keyHash,
        keyPrefix,
        parsed.data.scopes,
        parsed.data.expires_at ?? null,
      ],
    );

    server.log.info({ tenantId, userId, keyId: key.id }, "api_key.created");

    // Return the raw key ONCE — it's never retrievable again.
    return reply.status(201).send({ success: true, data: { ...key, key: rawKey } });
  });

  // DELETE /api/v1/api-keys/:id
  server.delete("/:id", async (request, reply) => {
    const { id }       = request.params as { id: string };
    const { tenantId } = request.user;
    const { rows: [key] } = await pool.query(
      `UPDATE api_keys
          SET is_active = FALSE
        WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [id, tenantId],
    );
    if (!key) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    server.log.info({ tenantId, keyId: id }, "api_key.revoked");
    return reply.status(204).send();
  });
}

// ── API key lookup helper (used by auth middleware) ────────────────────────────

export async function lookupApiKey(rawKey: string): Promise<{
  tenantId: string;
  userId:   string;
  scopes:   string[];
} | null> {
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const { rows: [key] } = await pool.query<{
    tenant_id:  string;
    created_by: string;
    scopes:     string[];
    expires_at: string | null;
  }>(
    `SELECT tenant_id, created_by, scopes, expires_at
       FROM api_keys
      WHERE key_hash = $1 AND is_active = TRUE`,
    [keyHash],
  );

  if (!key) return null;
  if (key.expires_at && new Date(key.expires_at) < new Date()) return null;

  // Update last_used_at non-blocking.
  pool.query(`UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1`, [keyHash]).catch((err) => { console.error("[api-keys] last_used_at update failed:", err.message); });

  return {
    tenantId: key.tenant_id,
    userId:   key.created_by,
    scopes:   key.scopes,
  };
}
