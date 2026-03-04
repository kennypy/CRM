/**
 * Client-side auth utilities.
 *
 * Tokens (access + refresh) are stored exclusively in HttpOnly, SameSite=Strict
 * cookies set by the server-side Route Handlers in /api/auth/*.
 * They are NOT readable from JavaScript — this eliminates XSS-based token theft.
 *
 * Only the user profile object is kept in localStorage (non-sensitive metadata
 * used for UI — role badges, initials, etc.).  Actual authorisation is always
 * enforced by the backend via JWT verification.
 */

export interface StoredUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
  tenantName: string;
}

const USER_KEY = "nexcrm_user";

/**
 * Persist user profile after a successful login / register.
 * Tokens are set as HttpOnly cookies by the server — do not handle them here.
 */
export function setAuth(_accessToken: string, _refreshToken: string, user: StoredUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Clear user profile and instruct the server to clear the HttpOnly token cookies.
 * Returns a promise so callers can await the logout before navigating.
 */
export async function clearAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  localStorage.removeItem(USER_KEY);
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // Best-effort — cookies will expire naturally
  }
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

/**
 * Returns true when a user profile exists in localStorage.
 * The HttpOnly access token cookie is what actually gates API calls —
 * this is only used for UI-level "are we logged in?" checks.
 */
export function isAuthenticated(): boolean {
  return !!getStoredUser();
}

/**
 * @deprecated Tokens are now in HttpOnly cookies and are not readable from JS.
 * Returns null. Kept for backwards compatibility during migration.
 */
export function getToken(): null {
  return null;
}
