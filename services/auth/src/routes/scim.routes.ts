/**
 * SCIM 2.0 provisioning endpoint (RFC 7643/7644) — lets identity providers
 * (Okta, Azure AD, OneLogin) create, update, deactivate, and reactivate users.
 *
 * Mounted at /scim/v2 and reached by IdPs through the web app's public proxy
 * (${APP_URL}/scim/v2). Authentication is a per-tenant bearer token
 * (scim_tokens table, SHA-256 hash at rest) managed by workspace admins from
 * Settings → Security; every operation is scoped to the token's tenant.
 *
 * User mapping: userName = email; active = (deleted_at IS NULL), so
 * deactivation soft-deletes and reactivation restores. New users get role
 * 'rep' with no password (SSO-only), same as SAML/OIDC JIT provisioning.
 */

import { createHash } from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db";
import type { DBUser } from "../users";

type ScimUserRow = DBUser & { deleted_at: string | null; created_at: string; updated_at: string };

const USER_SCHEMA  = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA  = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

function scimError(reply: FastifyReply, status: number, detail: string, scimType?: string) {
  return reply
    .status(status)
    .header("Content-Type", "application/scim+json")
    .send({ schemas: [ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) });
}

function toScimUser(u: ScimUserRow) {
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    userName: u.email,
    name: { givenName: u.first_name ?? "", familyName: u.last_name ?? "" },
    emails: [{ value: u.email, type: "work", primary: true }],
    active: u.deleted_at === null,
    meta: {
      resourceType: "User",
      created: u.created_at,
      lastModified: u.updated_at,
    },
  };
}

/** Fields a SCIM write can change, accumulated from a PUT body or PATCH ops. */
interface UserChanges {
  email?:     string;
  firstName?: string;
  lastName?:  string;
  active?:    boolean;
}

function coerceBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^true$/i.test(v)) return true;
    if (/^false$/i.test(v)) return false;
  }
  return undefined;
}

/** Map a SCIM User resource (POST/PUT body) to our fields. */
function changesFromResource(body: Record<string, unknown>): UserChanges {
  const out: UserChanges = {};
  if (typeof body.userName === "string" && body.userName.includes("@")) out.email = body.userName.toLowerCase();
  const name = body.name as Record<string, unknown> | undefined;
  if (name && typeof name.givenName === "string") out.firstName = name.givenName;
  if (name && typeof name.familyName === "string") out.lastName = name.familyName;
  const active = coerceBool(body.active);
  if (active !== undefined) out.active = active;
  if (!out.email && Array.isArray(body.emails)) {
    const primary = (body.emails as Array<Record<string, unknown>>).find((e) => e && typeof e.value === "string");
    if (primary && typeof primary.value === "string" && primary.value.includes("@")) {
      out.email = primary.value.toLowerCase();
    }
  }
  return out;
}

/** Apply RFC 7644 PATCH operations (the subset real IdPs send). */
function changesFromPatch(ops: Array<Record<string, unknown>>): UserChanges {
  const out: UserChanges = {};
  for (const op of ops) {
    const kind = String(op.op ?? "").toLowerCase();
    if (kind !== "replace" && kind !== "add") continue;
    const path = typeof op.path === "string" ? op.path : "";
    const value = op.value;

    if (!path) {
      Object.assign(out, changesFromResource((value ?? {}) as Record<string, unknown>));
      continue;
    }
    if (path === "userName" && typeof value === "string" && value.includes("@")) {
      out.email = value.toLowerCase();
    } else if (path === "active") {
      const active = coerceBool(value);
      if (active !== undefined) out.active = active;
    } else if (path === "name.givenName" && typeof value === "string") {
      out.firstName = value;
    } else if (path === "name.familyName" && typeof value === "string") {
      out.lastName = value;
    } else if (/^emails\[.*\]\.value$/.test(path) && typeof value === "string" && value.includes("@")) {
      out.email = value.toLowerCase();
    }
  }
  return out;
}

async function applyChanges(tenantId: string, userId: string, changes: UserChanges): Promise<ScimUserRow | null> {
  const { rows } = await pool.query<ScimUserRow>(
    `UPDATE users SET
       email      = COALESCE($3, email),
       first_name = COALESCE($4, first_name),
       last_name  = COALESCE($5, last_name),
       deleted_at = CASE WHEN $6::boolean IS NULL THEN deleted_at
                         WHEN $6::boolean THEN NULL
                         ELSE COALESCE(deleted_at, NOW()) END,
       updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [userId, tenantId, changes.email ?? null, changes.firstName ?? null, changes.lastName ?? null, changes.active ?? null],
  );
  return rows[0] ?? null;
}

export async function scimRoutes(server: FastifyInstance) {
  // IdPs send application/scim+json; parse it like JSON (scoped to this plugin).
  server.addContentTypeParser("application/scim+json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body === "" ? {} : JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Bearer-token auth: resolve the tenant for every request.
  server.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      reply.header("WWW-Authenticate", 'Bearer realm="scim"');
      return scimError(reply, 401, "Authentication required");
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { rows } = await pool.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM scim_tokens WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
    if (!rows[0]) {
      reply.header("WWW-Authenticate", 'Bearer realm="scim"');
      return scimError(reply, 401, "Invalid or revoked SCIM token");
    }
    (request as FastifyRequest & { scimTenantId?: string }).scimTenantId = rows[0].tenant_id;
    pool.query(`UPDATE scim_tokens SET last_used_at = NOW() WHERE id = $1`, [rows[0].id])
      .catch((err) => server.log.warn({ err }, "scim.last_used_update_failed"));
  });

  const tenantOf = (request: FastifyRequest): string =>
    (request as FastifyRequest & { scimTenantId?: string }).scimTenantId as string;

  // GET /ServiceProviderConfig — capability discovery.
  server.get("/ServiceProviderConfig", async (_request, reply) => {
    return reply.header("Content-Type", "application/scim+json").send({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        { type: "oauthbearertoken", name: "Bearer token", description: "SCIM token from Settings → Security" },
      ],
    });
  });

  // GET /Users — list with optional eq filter + 1-based pagination.
  server.get<{ Querystring: { filter?: string; startIndex?: string; count?: string } }>(
    "/Users",
    async (request, reply) => {
      const tenantId = tenantOf(request);
      const startIndex = Math.max(1, parseInt(request.query.startIndex ?? "1", 10) || 1);
      const count = Math.min(200, Math.max(0, parseInt(request.query.count ?? "100", 10) || 100));

      let where = `tenant_id = $1`;
      const params: unknown[] = [tenantId];
      const filter = (request.query.filter ?? "").trim();
      if (filter) {
        const m = filter.match(/^(userName|emails(?:\[.*\])?\.value) eq "([^"]+)"$/i);
        if (!m) {
          // A filter on an attribute we don't index (e.g. externalId) matches nothing.
          return reply.header("Content-Type", "application/scim+json").send({
            schemas: [LIST_SCHEMA], totalResults: 0, startIndex, itemsPerPage: 0, Resources: [],
          });
        }
        params.push(m[2].toLowerCase());
        where += ` AND lower(email) = $2`;
      }

      const { rows: [{ n }] } = await pool.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM users WHERE ${where}`, params,
      );
      const { rows } = await pool.query<ScimUserRow>(
        `SELECT * FROM users WHERE ${where} ORDER BY created_at ASC OFFSET ${startIndex - 1} LIMIT ${count}`,
        params,
      );

      return reply.header("Content-Type", "application/scim+json").send({
        schemas: [LIST_SCHEMA],
        totalResults: parseInt(n, 10),
        startIndex,
        itemsPerPage: rows.length,
        Resources: rows.map(toScimUser),
      });
    },
  );

  // GET /Users/:id
  server.get<{ Params: { id: string } }>("/Users/:id", async (request, reply) => {
    const { rows } = await pool.query<ScimUserRow>(
      `SELECT * FROM users WHERE id = $1 AND tenant_id = $2`,
      [request.params.id, tenantOf(request)],
    );
    if (!rows[0]) return scimError(reply, 404, "User not found");
    return reply.header("Content-Type", "application/scim+json").send(toScimUser(rows[0]));
  });

  // POST /Users — create (JIT-equivalent; 409 when the email already exists).
  server.post("/Users", async (request, reply) => {
    const tenantId = tenantOf(request);
    const changes = changesFromResource((request.body ?? {}) as Record<string, unknown>);
    if (!changes.email) return scimError(reply, 400, "userName must be an email address", "invalidValue");

    const { rows: existing } = await pool.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
      [tenantId, changes.email],
    );
    if (existing[0]) return scimError(reply, 409, "A user with this userName already exists", "uniqueness");

    const { rows } = await pool.query<ScimUserRow>(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role, deleted_at)
       VALUES ($1, $2, $3, $4, 'rep', CASE WHEN $5::boolean THEN NULL ELSE NOW() END)
       RETURNING *`,
      [tenantId, changes.email, changes.firstName ?? changes.email.split("@")[0], changes.lastName ?? "", changes.active ?? true],
    );
    return reply.status(201).header("Content-Type", "application/scim+json").send(toScimUser(rows[0]));
  });

  // PUT /Users/:id — full replace of the mapped fields.
  server.put<{ Params: { id: string } }>("/Users/:id", async (request, reply) => {
    const changes = changesFromResource((request.body ?? {}) as Record<string, unknown>);
    const row = await applyChanges(tenantOf(request), request.params.id, changes);
    if (!row) return scimError(reply, 404, "User not found");
    return reply.header("Content-Type", "application/scim+json").send(toScimUser(row));
  });

  // PATCH /Users/:id — partial update (deactivate/reactivate, renames).
  server.patch<{ Params: { id: string } }>("/Users/:id", async (request, reply) => {
    const body = (request.body ?? {}) as { schemas?: string[]; Operations?: Array<Record<string, unknown>> };
    if (!Array.isArray(body.Operations) || (body.schemas && !body.schemas.includes(PATCH_SCHEMA))) {
      return scimError(reply, 400, "Expected a PatchOp with Operations", "invalidSyntax");
    }
    const changes = changesFromPatch(body.Operations);
    const row = await applyChanges(tenantOf(request), request.params.id, changes);
    if (!row) return scimError(reply, 404, "User not found");
    return reply.header("Content-Type", "application/scim+json").send(toScimUser(row));
  });

  // DELETE /Users/:id — soft-delete (deactivate).
  server.delete<{ Params: { id: string } }>("/Users/:id", async (request, reply) => {
    const { rows } = await pool.query(
      `UPDATE users SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [request.params.id, tenantOf(request)],
    );
    if (!rows[0]) return scimError(reply, 404, "User not found");
    return reply.status(204).send();
  });
}
