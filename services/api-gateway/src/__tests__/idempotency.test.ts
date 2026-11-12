import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { createIdempotency, withStoreTimeout, type IdempotencyStore } from "../middleware/idempotency";
import { FakeRedis } from "./fake-redis";

let redis: FakeRedis;
let calls: number;

function build(store: IdempotencyStore = redis, opts: { slow?: Promise<void> } = {}) {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async (req) => {
    (req as any).user = { tenantId: String(req.headers["x-tenant"] ?? "t1"), sub: "u1" };
  });
  const idem = createIdempotency(store);
  app.addHook("preHandler", idem.preHandler);
  app.addHook("onSend", idem.onSend);
  app.post("/api/v1/deals", async (req, reply) => {
    calls++;
    if (opts.slow) await opts.slow;
    const body = req.body as any;
    if (body?.fail === "500") { const e: any = new Error("boom"); e.statusCode = 500; throw e; }
    if (body?.fail === "400") return reply.status(400).send({ success: false, error: { code: "BAD" } });
    return reply.status(201).send({ success: true, data: { id: `deal-${calls}` } });
  });
  app.get("/api/v1/deals", async () => { calls++; return { ok: true }; });
  return app;
}

const post = (app: ReturnType<typeof build>, payload: unknown, key?: string, tenant = "t1") =>
  app.inject({
    method: "POST", url: "/api/v1/deals", payload: payload as any,
    headers: { ...(key ? { "idempotency-key": key } : {}), "x-tenant": tenant },
  });

beforeEach(() => { redis = new FakeRedis(); calls = 0; });

describe("idempotency middleware", () => {
  it("replays the first 2xx response for a retried key", async () => {
    const app = build();
    const a = await post(app, { name: "x" }, "k1");
    const b = await post(app, { name: "x" }, "k1");
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json()).toEqual(a.json());
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(calls).toBe(1);
  });

  it("does nothing without the header", async () => {
    const app = build();
    await post(app, { name: "x" });
    await post(app, { name: "x" });
    expect(calls).toBe(2);
  });

  it("422s when the key is reused with a different body", async () => {
    const app = build();
    await post(app, { name: "x" }, "k1");
    const b = await post(app, { name: "y" }, "k1");
    expect(b.statusCode).toBe(422);
    expect(b.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("409s for a concurrent duplicate still in progress", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    const app = build(redis, { slow });
    const first = post(app, { name: "x" }, "k1");
    await new Promise((r) => setTimeout(r, 20));
    const second = await post(app, { name: "x" }, "k1");
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    release();
    expect((await first).statusCode).toBe(201);
  });

  it("caches 4xx but not 5xx", async () => {
    const app = build();
    await post(app, { fail: "400" }, "k4");
    const r4 = await post(app, { fail: "400" }, "k4");
    expect(r4.statusCode).toBe(400);
    expect(r4.headers["idempotent-replayed"]).toBe("true");

    await post(app, { fail: "500" }, "k5");
    const r5 = await post(app, { fail: "500" }, "k5");
    expect(r5.headers["idempotent-replayed"]).toBeUndefined();
    expect(calls).toBe(3);
  });

  it("scopes keys per tenant", async () => {
    const app = build();
    await post(app, { name: "x" }, "k1", "t1");
    const other = await post(app, { name: "x" }, "k1", "t2");
    expect(other.headers["idempotent-replayed"]).toBeUndefined();
    expect(calls).toBe(2);
  });

  it("ignores GET and rejects malformed keys", async () => {
    const app = build();
    const bad = await post(app, { name: "x" }, "x".repeat(300));
    expect(bad.statusCode).toBe(400);
    const g = await app.inject({ method: "GET", url: "/api/v1/deals", headers: { "idempotency-key": "k" } });
    expect(g.statusCode).toBe(200);
  });

  it("fails open when redis is down", async () => {
    redis.down = true;
    const app = build();
    const a = await post(app, { name: "x" }, "k1");
    const b = await post(app, { name: "x" }, "k1");
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(calls).toBe(2);
  });

  it("fails open when redis hangs (bounded by timeout)", async () => {
    const hanging: IdempotencyStore = {
      get: () => new Promise(() => {}), set: () => new Promise(() => {}), del: () => new Promise(() => {}),
    };
    const app = build(withStoreTimeout(hanging, 50));
    const a = await post(app, { name: "x" }, "k1");
    expect(a.statusCode).toBe(201);
  });
});
