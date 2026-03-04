/**
 * Authenticated API client.
 *
 * All /api/v1/* calls go through the Next.js Route Handler proxy
 * (src/app/api/v1/[...path]/route.ts) which reads the HttpOnly session cookie
 * server-side and injects the Authorization: Bearer header before forwarding
 * to the API gateway.  The token is therefore NEVER visible to client JS.
 *
 * credentials: "include" ensures the HttpOnly cookie is sent on every request.
 */

async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "include", // Send HttpOnly session cookie to same-origin proxy
  });

  if (res.status === 401) {
    // Token expired — attempt a silent refresh then redirect
    try {
      const refreshRes = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (refreshRes.ok) {
        // Retry original request once with the new cookie the server just set
        return fetch(path, { ...options, headers, credentials: "include" });
      }
    } catch {
      // Refresh failed — fall through to redirect
    }

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

  /**
   * Public calls (login, register) — these target the Next.js auth Route
   * Handlers which call the auth service server-side.  No Bearer token needed.
   */
  public: {
    post: (path: string, body: unknown) =>
      fetch(path, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify(body),
      }),
  },
};
