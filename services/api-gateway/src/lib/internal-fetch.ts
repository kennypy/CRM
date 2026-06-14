/**
 * Wrapper around fetch() for gateway → internal-service calls.
 * Automatically injects the x-service-token header so downstream
 * service-token middleware accepts the request.
 *
 * Use this instead of bare fetch() for any call to graph-core,
 * outreach, ai-engine, or auth internal endpoints.
 */

import type { FastifyRequest } from "fastify";

export function internalFetch(
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = process.env.INTERNAL_SERVICE_SECRET ?? "";
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("x-service-token", token);
  }
  return fetch(url, { ...init, headers });
}

/**
 * Mint a short-lived internal JWT from the gateway's already-verified
 * `request.user`. This lets downstream services cryptographically verify the
 * caller's tenant/identity (and reject a forged `?tenantId=`), and works
 * uniformly whether the user authenticated with a JWT or an API key.
 */
export function mintInternalToken(request: FastifyRequest): string | null {
  const u = request.user as
    | { sub?: string; tenantId?: string; role?: string; scopes?: string[] }
    | undefined;
  if (!u?.tenantId) return null;
  // request.server.jwt is provided by @fastify/jwt registered on the gateway.
  return (request.server as any).jwt.sign(
    { sub: u.sub, tenantId: u.tenantId, role: u.role, scopes: u.scopes, int: true },
    { expiresIn: "60s" },
  );
}

/**
 * Identity headers (incl. the minted internal JWT) for gateway → internal-service
 * calls made via `internalFetch`. Mirrors what `createProxy` injects.
 */
export function internalIdentityHeaders(request: FastifyRequest): Record<string, string> {
  const u = request.user as
    | { sub?: string; tenantId?: string; role?: string }
    | undefined;
  const headers: Record<string, string> = {
    "x-user-id":   u?.sub      ?? "",
    "x-tenant-id": u?.tenantId ?? "",
    "x-user-role": u?.role     ?? "",
  };
  const token = mintInternalToken(request);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

