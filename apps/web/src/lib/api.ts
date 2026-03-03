/**
 * Authenticated API client.
 * Wraps fetch() with:
 *   - Authorization: Bearer <token> header injection
 *   - 401 → clear auth + redirect to /login
 *   - JSON body serialisation
 */

import { getToken, clearAuth } from "./auth";

async function apiFetch(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<Response> {
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token && !options.skipAuth) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const { skipAuth: _, ...fetchOptions } = options;
  const res = await fetch(path, { ...fetchOptions, headers });

  if (res.status === 401) {
    clearAuth();
    // Use location.replace so the browser history doesn't pile up
    if (typeof window !== "undefined") {
      window.location.replace(
        `/login?next=${encodeURIComponent(window.location.pathname)}`
      );
    }
  }

  return res;
}

export const api = {
  get:    (path: string)                => apiFetch(path, { method: "GET" }),
  post:   (path: string, body: unknown) => apiFetch(path, { method: "POST",   body: JSON.stringify(body) }),
  patch:  (path: string, body: unknown) => apiFetch(path, { method: "PATCH",  body: JSON.stringify(body) }),
  delete: (path: string)                => apiFetch(path, { method: "DELETE" }),
  /** Public call (no auth header) – used for login/register */
  public: {
    post: (path: string, body: unknown) =>
      apiFetch(path, { method: "POST", body: JSON.stringify(body), skipAuth: true }),
  },
};
