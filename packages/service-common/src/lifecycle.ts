/**
 * Health probes + graceful shutdown shared by the Node services.
 *
 *   GET /health        legacy liveness (unchanged response shape, kept for compat)
 *   GET /health/live   process is up and the event loop is responsive → 200
 *   GET /health/ready  every dependency check passes → 200, otherwise 503 with a
 *                      per-dependency status map. Also 503 once shutdown starts,
 *                      so load balancers / Kubernetes stop routing new traffic
 *                      to a pod that is draining.
 *
 * Probe paths must be exempted from auth, service-token and rate-limit hooks in
 * each service (see HEALTH_PATHS).
 *
 * Graceful shutdown (SIGTERM / SIGINT):
 *   1. readiness flips to 503
 *   2. wait `drainDelayMs` so the LB/endpoint controller observes it
 *   3. server.close() — stop accepting, let in-flight requests finish
 *   4. run `onClose` hooks (pools, redis, workers)
 *   5. exit 0; a hard timer exits 1 after `timeoutMs` if anything hangs
 */

import type { FastifyInstance } from "fastify";

export const HEALTH_PATHS = ["/health", "/health/live", "/health/ready"] as const;

export function isHealthPath(url: string): boolean {
  const path = url.split("?")[0];
  return (HEALTH_PATHS as readonly string[]).includes(path);
}

export interface DependencyCheck {
  name: string;
  /** Resolve on healthy, throw/reject on unhealthy. */
  check: () => Promise<unknown>;
  /** Per-check timeout (default 2000 ms). */
  timeoutMs?: number;
}

export interface DependencyResult {
  status: "ok" | "fail";
  latencyMs: number;
  error?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} check timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function runChecks(checks: DependencyCheck[]): Promise<{
  ok: boolean;
  dependencies: Record<string, DependencyResult>;
}> {
  const results = await Promise.all(
    checks.map(async (c): Promise<[string, DependencyResult]> => {
      const start = Date.now();
      try {
        await withTimeout(Promise.resolve().then(c.check), c.timeoutMs ?? 2000, c.name);
        return [c.name, { status: "ok", latencyMs: Date.now() - start }];
      } catch (err) {
        return [
          c.name,
          {
            status: "fail",
            latencyMs: Date.now() - start,
            error: err instanceof Error ? err.message : String(err),
          },
        ];
      }
    }),
  );
  const dependencies = Object.fromEntries(results);
  return { ok: results.every(([, r]) => r.status === "ok"), dependencies };
}

// ── Common check factories ─────────────────────────────────────────────────

/** Postgres `SELECT 1` via any pg-compatible pool. */
export function pgCheck(pool: { query: (sql: string) => Promise<unknown> }, name = "postgres"): DependencyCheck {
  return { name, check: () => pool.query("SELECT 1") };
}

/** Redis PING. */
export function redisCheck(client: { ping: () => Promise<string> }, name = "redis"): DependencyCheck {
  return {
    name,
    check: async () => {
      const res = await client.ping();
      if (res !== "PONG") throw new Error(`unexpected PING reply: ${res}`);
    },
  };
}

/** HTTP GET expecting a 2xx (e.g. a downstream /health/live). */
export function httpCheck(name: string, url: string, timeoutMs = 2000): DependencyCheck {
  return {
    name,
    timeoutMs,
    check: async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } finally {
        clearTimeout(t);
      }
    },
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

export interface HealthState {
  readonly shuttingDown: boolean;
  markShuttingDown(): void;
}

export function registerHealthRoutes(
  server: FastifyInstance,
  opts: { service: string; checks: DependencyCheck[] },
): HealthState {
  let shuttingDown = false;
  const state: HealthState = {
    get shuttingDown() { return shuttingDown; },
    markShuttingDown() { shuttingDown = true; },
  };

  // Legacy — unchanged shape.
  server.get("/health", async () => ({
    status: "ok",
    service: opts.service,
    timestamp: new Date().toISOString(),
  }));

  server.get("/health/live", async () => ({
    status: "ok",
    service: opts.service,
    uptimeSec: Math.round(process.uptime()),
  }));

  server.get("/health/ready", async (_request, reply) => {
    if (shuttingDown) {
      return reply.status(503).send({
        status: "shutting_down",
        service: opts.service,
        dependencies: {},
      });
    }
    const { ok, dependencies } = await runChecks(opts.checks);
    return reply.status(ok ? 200 : 503).send({
      status: ok ? "ok" : "degraded",
      service: opts.service,
      timestamp: new Date().toISOString(),
      dependencies,
    });
  });

  return state;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────

export interface ShutdownOptions {
  service: string;
  health?: HealthState;
  /** Resources to close after the HTTP server has drained (pools, redis, workers). */
  onClose?: Array<() => Promise<unknown> | unknown>;
  /** Hard exit deadline (default 25s — under the k8s default 30s grace period). */
  timeoutMs?: number;
  /** Delay between flipping readiness and closing the listener (default 5s,
   * env SHUTDOWN_DRAIN_DELAY_MS). Lets LBs observe the 503 first. */
  drainDelayMs?: number;
  signals?: NodeJS.Signals[];
  /** Injected for tests. */
  exit?: (code: number) => void;
}

export function installGracefulShutdown(server: FastifyInstance, opts: ShutdownOptions): () => Promise<void> {
  const timeoutMs = opts.timeoutMs ?? parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "25000", 10);
  const drainDelayMs = opts.drainDelayMs ?? parseInt(process.env.SHUTDOWN_DRAIN_DELAY_MS ?? "5000", 10);
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let started = false;

  const shutdown = async (signal = "manual"): Promise<void> => {
    if (started) return;
    started = true;
    server.log.info({ signal, service: opts.service }, "shutdown.start");
    opts.health?.markShuttingDown();

    const hard = setTimeout(() => {
      server.log.error({ timeoutMs }, "shutdown.timeout — forcing exit");
      exit(1);
    }, timeoutMs);
    hard.unref();

    try {
      if (drainDelayMs > 0) await new Promise((r) => setTimeout(r, drainDelayMs));
      await server.close();
      for (const close of opts.onClose ?? []) {
        try {
          await close();
        } catch (err) {
          server.log.warn({ err }, "shutdown.close_hook_failed");
        }
      }
      server.log.info("shutdown.complete");
      clearTimeout(hard);
      exit(0);
    } catch (err) {
      server.log.error({ err }, "shutdown.failed");
      clearTimeout(hard);
      exit(1);
    }
  };

  for (const sig of opts.signals ?? (["SIGTERM", "SIGINT"] as NodeJS.Signals[])) {
    process.once(sig, () => { void shutdown(sig); });
  }
  return () => shutdown();
}
