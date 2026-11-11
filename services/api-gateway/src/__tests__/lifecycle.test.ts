import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import {
  registerHealthRoutes, installGracefulShutdown, runChecks, isHealthPath,
} from "@nexcrm/service-common/lifecycle";

describe("health probes", () => {
  it("live is always 200; ready reflects dependencies", async () => {
    let dbUp = true;
    const app = Fastify({ logger: false });
    registerHealthRoutes(app, {
      service: "svc",
      checks: [
        { name: "postgres", check: async () => { if (!dbUp) throw new Error("conn refused"); } },
        { name: "redis", check: async () => "PONG" },
      ],
    });
    expect((await app.inject("/health")).json().status).toBe("ok");
    expect((await app.inject("/health/live")).statusCode).toBe(200);
    const ok = await app.inject("/health/ready");
    expect(ok.statusCode).toBe(200);
    expect(ok.json().dependencies.postgres.status).toBe("ok");
    dbUp = false;
    const bad = await app.inject("/health/ready");
    expect(bad.statusCode).toBe(503);
    expect(bad.json().dependencies.postgres).toMatchObject({ status: "fail", error: "conn refused" });
    expect(bad.json().dependencies.redis.status).toBe("ok");
  });

  it("times out a hanging dependency", async () => {
    const r = await runChecks([{ name: "slow", timeoutMs: 20, check: () => new Promise(() => {}) }]);
    expect(r.ok).toBe(false);
    expect(r.dependencies.slow.error).toMatch(/timed out/);
  });

  it("isHealthPath ignores query strings", () => {
    expect(isHealthPath("/health/ready?x=1")).toBe(true);
    expect(isHealthPath("/healthz")).toBe(false);
  });
});

describe("graceful shutdown", () => {
  it("flips readiness, closes the server, runs close hooks, exits 0", async () => {
    const app = Fastify({ logger: false });
    const health = registerHealthRoutes(app, { service: "svc", checks: [] });
    const order: string[] = [];
    let code: number | undefined;
    const trigger = installGracefulShutdown(app, {
      service: "svc", health, drainDelayMs: 0, timeoutMs: 1000, signals: [],
      onClose: [() => { order.push("pool"); }, async () => { order.push("redis"); throw new Error("ignored"); }],
      exit: (c) => { code = c; },
    });
    await app.ready();
    expect((await app.inject("/health/ready")).statusCode).toBe(200);
    const p = trigger();
    expect(health.shuttingDown).toBe(true);
    await p;
    expect(order).toEqual(["pool", "redis"]);
    expect(code).toBe(0);
  });
});
