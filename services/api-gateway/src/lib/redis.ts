/**
 * Shared Redis client for the API gateway service.
 *
 * In production, REDIS_URL must be set — the service will refuse to start with
 * hardcoded dev credentials. In development, falls back to the local Docker
 * Compose Redis instance.
 */

import Redis from "ioredis";

const DEV_REDIS_URL = "redis://:nexcrm_redis_dev_password@localhost:6379";

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url) return url;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL: REDIS_URL environment variable is not set. " +
      "Refusing to start in production with hardcoded dev credentials.",
    );
  }

  return DEV_REDIS_URL;
}

/** Singleton ioredis client for general Redis operations. */
export const redis = new Redis(getRedisUrl(), {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

/**
 * Returns a BullMQ-compatible connection config object.
 * BullMQ requires `{ host, port, password }` rather than a URL string.
 */
export function redisConnection() {
  const url = getRedisUrl();
  const u = new URL(url);
  return {
    host:                 u.hostname || "localhost",
    port:                 parseInt(u.port || "6379", 10),
    password:             u.password ? decodeURIComponent(u.password) : undefined,
    maxRetriesPerRequest: null as null,
  };
}
