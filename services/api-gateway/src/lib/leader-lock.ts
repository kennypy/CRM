/**
 * Redis leader lock for interval pollers that must run as a singleton across
 * gateway replicas (workflow-engine event cursor, scheduled-report delivery).
 * BullMQ workers don't need this — BullMQ already hands each job to exactly
 * one consumer.
 *
 * Each process has a random owner token. On every tick the process either
 * acquires the lock (SET NX PX) or, if it already owns it, renews it (atomic
 * compare-and-pexpire via Lua). Only the owner runs the tick body. If the
 * leader dies, the lock expires after `ttlMs` and another replica takes over
 * on its next tick.
 *
 * If Redis is unreachable the tick is skipped (fail closed): running a
 * singleton job on every replica would double-send reports / double-fire
 * workflow actions, which is worse than a short pause.
 */

import { randomUUID } from "crypto";

export interface LockClient {
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: any[]): Promise<unknown>;
}

const RENEW_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end`;

const RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`;

export interface LeaderLock {
  /** Try to acquire/renew; resolves true if this process is the leader. */
  tick(): Promise<boolean>;
  /** True if the previous tick() made this process leader for the first time. */
  readonly justElected: boolean;
  release(): Promise<void>;
}

export function createLeaderLock(client: LockClient, name: string, ttlMs = 30_000, timeoutMs = 1_000): LeaderLock {
  const key = `lock:leader:${name}`;
  const owner = `${process.env.HOSTNAME ?? "proc"}:${process.pid}:${randomUUID()}`;
  let isLeader = false;
  let justElected = false;

  const bounded = <T>(p: Promise<T>): Promise<T> => {
    let t: NodeJS.Timeout;
    return Promise.race([
      p,
      new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("leader-lock redis timeout")), timeoutMs); }),
    ]).finally(() => clearTimeout(t));
  };

  return {
    get justElected() { return justElected; },
    async tick() {
      try {
        if (isLeader) {
          const renewed = await bounded(client.eval(RENEW_LUA, 1, key, owner, ttlMs));
          if (Number(renewed) === 1) { justElected = false; return true; }
          isLeader = false;
        }
        const got = await bounded(client.set(key, owner, "PX", ttlMs, "NX"));
        justElected = got === "OK";
        isLeader = justElected;
        return isLeader;
      } catch (err) {
        if (isLeader) console.warn(`[leader-lock:${name}] lost contact with redis, stepping down:`, (err as Error).message);
        isLeader = false;
        justElected = false;
        return false;
      }
    },
    async release() {
      if (!isLeader) return;
      isLeader = false;
      await bounded(client.eval(RELEASE_LUA, 1, key, owner)).catch(() => {});
    },
  };
}

/** RUN_WORKERS=false disables background workers in this process (API-only
 * replicas). Default: enabled, preserving docker-compose behaviour. */
export function workersEnabled(): boolean {
  return (process.env.RUN_WORKERS ?? "true").toLowerCase() !== "false";
}
