import { describe, it, expect, afterEach } from "vitest";
import { createLeaderLock, workersEnabled } from "../lib/leader-lock";
import { FakeRedis } from "./fake-redis";

describe("leader lock", () => {
  it("elects exactly one leader and fails over after expiry", async () => {
    const r = new FakeRedis();
    let t = 1_000;
    r.now = () => t;
    const a = createLeaderLock(r, "job", 100);
    const b = createLeaderLock(r, "job", 100);
    expect(await a.tick()).toBe(true);
    expect(a.justElected).toBe(true);
    expect(await b.tick()).toBe(false);
    t += 50;
    expect(await a.tick()).toBe(true);   // renewal
    expect(a.justElected).toBe(false);
    t += 80;                              // still within renewed ttl
    expect(await b.tick()).toBe(false);
    t += 200;                             // a stopped renewing → expires
    expect(await b.tick()).toBe(true);
    expect(await a.tick()).toBe(false);   // a notices it lost leadership
  });

  it("release lets another replica take over immediately", async () => {
    const r = new FakeRedis();
    const a = createLeaderLock(r, "job", 10_000);
    const b = createLeaderLock(r, "job", 10_000);
    await a.tick();
    await a.release();
    expect(await b.tick()).toBe(true);
  });

  it("fails closed when redis is unavailable", async () => {
    const r = new FakeRedis();
    const a = createLeaderLock(r, "job", 10_000);
    expect(await a.tick()).toBe(true);
    r.down = true;
    expect(await a.tick()).toBe(false);
  });
});

describe("workersEnabled", () => {
  const orig = process.env.RUN_WORKERS;
  afterEach(() => { if (orig === undefined) delete process.env.RUN_WORKERS; else process.env.RUN_WORKERS = orig; });
  it("defaults on, disabled only by RUN_WORKERS=false", () => {
    delete process.env.RUN_WORKERS;
    expect(workersEnabled()).toBe(true);
    process.env.RUN_WORKERS = "false";
    expect(workersEnabled()).toBe(false);
    process.env.RUN_WORKERS = "true";
    expect(workersEnabled()).toBe(true);
  });
});
