/**
 * Idempotency-Key support for mutating API calls (POST / PATCH under /api/v1).
 *
 * A client that sends `Idempotency-Key: <opaque>` can safely retry a request
 * after a timeout or dropped connection: the first completed response (2xx or
 * 4xx) is stored for 24h and replayed verbatim for retries with the same key,
 * flagged with `idempotent-replayed: true`.
 *
 *   - Scope: tenant + user + method + path + key — keys never collide across
 *     tenants/users/endpoints.
 *   - Concurrent duplicate while the first is still running → 409
 *     IDEMPOTENCY_IN_PROGRESS.
 *   - Same key reused with a different request body → 422
 *     IDEMPOTENCY_KEY_REUSED.
 *   - 5xx responses are NOT stored (the lock is released) so the client can
 *     retry a genuinely failed request.
 *   - Redis unavailable → fail open (request proceeds without idempotency,
 *     warn logged). Availability beats exactly-once for a CRM write path.
 */

import { createHash } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface IdempotencyStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

interface StoredRecord {
  state: "in_progress" | "done";
  bodyHash: string;
  status?: number;
  contentType?: string;
  body?: string;
}

interface IdemContext {
  redisKey: string;
  bodyHash: string;
}

declare module "fastify" {
  interface FastifyRequest {
    idempotency?: IdemContext;
  }
}

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
/** Lock TTL for an in-flight request; long enough for slow AI/graph writes. */
export const IN_PROGRESS_TTL_MS = 60_000;
const KEY_RE = /^[\x21-\x7e]{1,255}$/;
const METHODS = new Set(["POST", "PATCH"]);

function hashBody(body: unknown): string {
  const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return createHash("sha256").update(raw).digest("hex");
}

function sendError(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) {
  return reply.status(status).send({
    success: false,
    error: { code, message, requestId: String(request.id) },
  });
}

/**
 * Bound every store call. The shared ioredis client is configured with
 * `maxRetriesPerRequest: null` (required by BullMQ), so while Redis is down
 * commands queue indefinitely — without this, "fail open" would be "hang".
 */
export function withStoreTimeout(store: IdempotencyStore, ms = 500): IdempotencyStore {
  const race = <T>(p: Promise<T>): Promise<T> => {
    let t: NodeJS.Timeout;
    return Promise.race([
      p,
      new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`idempotency store timeout after ${ms}ms`)), ms); }),
    ]).finally(() => clearTimeout(t));
  };
  return {
    get: (k) => race(store.get(k)),
    set: (k, v, ...a) => race(store.set(k, v, ...a)),
    del: (k) => race(store.del(k)),
  };
}

export function createIdempotency(store: IdempotencyStore) {
  async function preHandler(request: FastifyRequest, reply: FastifyReply) {
    if (!METHODS.has(request.method)) return;
    const path = request.url.split("?")[0];
    if (!path.startsWith("/api/v1/")) return;

    const rawKey = request.headers["idempotency-key"];
    if (rawKey === undefined) return;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (typeof key !== "string" || !KEY_RE.test(key)) {
      return sendError(reply, request, 400, "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key must be 1-255 printable ASCII characters");
    }

    const user = request.user as { tenantId?: string; sub?: string } | undefined;
    const tenant = user?.tenantId ?? "anon";
    const sub = user?.sub ?? "anon";
    const redisKey = `idem:${tenant}:${sub}:${request.method}:${path}:${key}`;
    const bodyHash = hashBody(request.body);

    try {
      const pending: StoredRecord = { state: "in_progress", bodyHash };
      const acquired = await store.set(redisKey, JSON.stringify(pending), "PX", IN_PROGRESS_TTL_MS, "NX");
      if (acquired === "OK") {
        request.idempotency = { redisKey, bodyHash };
        return;
      }

      const existingRaw = await store.get(redisKey);
      if (!existingRaw) {
        // Expired between SET NX and GET — treat as a fresh request without
        // idempotency rather than racing again.
        return;
      }
      const existing = JSON.parse(existingRaw) as StoredRecord;
      if (existing.bodyHash !== bodyHash) {
        return sendError(reply, request, 422, "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was already used with a different request body");
      }
      if (existing.state === "in_progress") {
        return sendError(reply, request, 409, "IDEMPOTENCY_IN_PROGRESS",
          "A request with this Idempotency-Key is still being processed");
      }
      reply.header("idempotent-replayed", "true");
      if (existing.contentType) reply.header("content-type", existing.contentType);
      return reply.status(existing.status ?? 200).send(existing.body ?? "");
    } catch (err) {
      request.log.warn({ err }, "idempotency.store_unavailable — failing open");
      return;
    }
  }

  async function onSend(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
    const ctx = request.idempotency;
    if (!ctx) return payload;
    // Only cache once, for the original request.
    request.idempotency = undefined;
    try {
      const status = reply.statusCode;
      const cacheable = typeof payload === "string" || Buffer.isBuffer(payload);
      if (status >= 500 || !cacheable) {
        await store.del(ctx.redisKey);
        return payload;
      }
      const ct = reply.getHeader("content-type");
      const rec: StoredRecord = {
        state: "done",
        bodyHash: ctx.bodyHash,
        status,
        contentType: typeof ct === "string" ? ct : undefined,
        body: Buffer.isBuffer(payload) ? payload.toString("utf8") : (payload as string),
      };
      await store.set(ctx.redisKey, JSON.stringify(rec), "EX", IDEMPOTENCY_TTL_SECONDS);
    } catch (err) {
      request.log.warn({ err }, "idempotency.store_write_failed");
    }
    return payload;
  }

  return { preHandler, onSend };
}
