/**
 * Wrapper around fetch() for gateway → internal-service calls.
 * Automatically injects the x-service-token header so downstream
 * service-token middleware accepts the request.
 *
 * Use this instead of bare fetch() for any call to graph-core,
 * outreach, ai-engine, or auth internal endpoints.
 */

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
