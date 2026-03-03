/**
 * Client-side auth utilities.
 * Tokens are stored in localStorage AND a cookie (cookie is read by middleware
 * for server-side redirect; localStorage is used in client fetch calls).
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

const TOKEN_KEY   = "nexcrm_token";
const REFRESH_KEY = "nexcrm_refresh_token";
const USER_KEY    = "nexcrm_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuth(token: string, refreshToken: string, user: StoredUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // Also write cookie so Next.js middleware can read it
  const maxAge = 15 * 60; // 15 minutes (matches JWT expiry)
  document.cookie = `${TOKEN_KEY}=${token}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
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

export function isAuthenticated(): boolean {
  return !!getToken();
}
