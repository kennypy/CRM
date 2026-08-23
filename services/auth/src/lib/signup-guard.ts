/**
 * Anti-abuse guards for public sandbox signup.
 *
 * Redis-backed rate limits (same hashed-key pattern as the forgot-password
 * limiter), Cloudflare Turnstile verification, a global live-sandbox capacity
 * cap, and Redis-hash signup metrics so abuse is visible without reading raw
 * logs. The pure decision helpers are exported separately so they can be
 * unit-tested without Redis or Postgres.
 */

import { createHash } from "crypto";
import { redis } from "@nexcrm/service-common/redis";
import { pool } from "../db";

// ── Limits ────────────────────────────────────────────────────────────────────

export const REGISTER_IP_MAX_PER_HOUR = 5;
export const REGISTER_DOMAIN_MAX_PER_DAY = 20;
export const RESEND_VERIFICATION_MAX_PER_HOUR = 3;

export function sandboxTtlDays(): number {
  return parseInt(process.env.SANDBOX_TTL_DAYS ?? "14", 10);
}

export function sandboxMaxTenants(): number {
  return parseInt(process.env.SANDBOX_MAX_TENANTS ?? "200", 10);
}

// ── Pure decision helpers (unit-tested) ───────────────────────────────────────

/** Rate-limit decision given the current counter value (null = no requests yet). */
export function isOverLimit(current: string | number | null, limit: number): boolean {
  if (current === null) return false;
  const n = typeof current === "number" ? current : parseInt(current, 10);
  return Number.isFinite(n) && n >= limit;
}

/** Global capacity decision. */
export function isAtCapacity(liveSandboxTenants: number, cap: number): boolean {
  return liveSandboxTenants >= cap;
}

/** Bare lowercase domain of an email address ("" if malformed). */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

// ── Redis-backed rate limiting ────────────────────────────────────────────────

const hashKey = (s: string) =>
  createHash("sha256").update(s.toLowerCase()).digest("hex");

/**
 * Check-and-bump a signup rate limit. Returns true when the request is
 * allowed. Keys are SHA-256 hashed (no raw IPs / domains in Redis).
 */
export async function allowAndBump(
  kind: "ip" | "domain" | "resend",
  identifier: string,
  limit: number,
  windowSecs: number,
): Promise<boolean> {
  const key = `signup:${kind}:${hashKey(identifier)}`;
  const current = await redis.get(key);
  if (isOverLimit(current, limit)) return false;
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, windowSecs);
  await pipeline.exec();
  return true;
}

// ── Capacity ──────────────────────────────────────────────────────────────────

export async function countLiveSandboxTenants(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM tenants WHERE is_sandbox IS TRUE AND deleted_at IS NULL`,
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

// ── Cloudflare Turnstile ──────────────────────────────────────────────────────

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Server-side Turnstile verification. Fails CLOSED: any network / parse error
 * counts as a failed challenge — a signup endpoint must not degrade open.
 */
export async function verifyTurnstile(token: string, remoteIp?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const outcome = (await res.json()) as { success?: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export type SignupMetric =
  | "attempts"
  | "created"
  | "verified"
  | "rejected_registration_disabled"
  | "rejected_validation"
  | "rejected_captcha"
  | "rejected_rate_limit_ip"
  | "rejected_rate_limit_domain"
  | "rejected_disposable_domain"
  | "rejected_at_capacity"
  | "rejected_slug_taken"
  | "resend_verification";

const METRICS_KEY = "signup:metrics";

/** Fire-and-forget: metrics must never fail a request. */
export function bumpSignupMetric(metric: SignupMetric): void {
  redis.hincrby(METRICS_KEY, metric, 1).catch(() => {});
}

export async function readSignupMetrics(): Promise<Record<string, number>> {
  const raw = await redis.hgetall(METRICS_KEY);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = parseInt(v, 10) || 0;
  return out;
}
