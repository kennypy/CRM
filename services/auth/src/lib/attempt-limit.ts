/**
 * Fixed-window attempt limiter for credential endpoints (login, reset).
 * Keyed by caller-chosen identity (e.g. ip + tenant + email) so one account
 * cannot be guessed quickly, while ordinary traffic from a shared office IP is
 * not throttled. Fails CLOSED when Redis is unavailable: losing brute-force
 * protection silently is worse than a brief sign-in outage.
 */
import { createHash } from "node:crypto";
import { requestRedis } from "@nexcrm/service-common/redis";

export async function allowAttempt(scope: string, identity: string, max: number, windowSecs: number): Promise<boolean> {
  const key = `auth:attempts:${scope}:${createHash("sha256").update(identity.toLowerCase()).digest("hex").slice(0, 32)}`;
  try {
    const redis = requestRedis();
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSecs);
    return n <= max;
  } catch {
    return false;
  }
}
