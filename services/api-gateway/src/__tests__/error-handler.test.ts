import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { errorHandler, notFoundHandler, resolveRequestId, codeForStatus } from "../middleware/error-handler";

function build() {
  const app = Fastify({ logger: false, genReqId: (req) => resolveRequestId(req.headers["x-request-id"]) });
  app.addHook("onRequest", async (req, reply) => { reply.header("x-request-id", String(req.id)); });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
  const fail = (status: number, msg: string) => async () => {
    const e: any = new Error(msg); e.statusCode = status; throw e;
  };
  app.get("/boom", async () => { throw new Error("db password=hunter2 leaked"); });
  app.get("/s/:status", async (req) => {
    const status = Number((req.params as any).status);
    return fail(status, `client problem ${status}`)();
  });
  app.post("/validated", { schema: { body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } }, async () => ({ ok: true }));
  return app;
}

const origEnv = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = origEnv; });

describe("gateway error handler", () => {
  it("hides 5xx messages in production and includes requestId", async () => {
    process.env.NODE_ENV = "production";
    const res = await build().inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("hunter2");
    expect(body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("shows 5xx messages outside production", async () => {
    process.env.NODE_ENV = "development";
    const res = await build().inject({ method: "GET", url: "/boom" });
    expect(res.json().error.message).toContain("leaked");
  });

  it.each([
    [400, "BAD_REQUEST"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"],
    [413, "PAYLOAD_TOO_LARGE"], [415, "UNSUPPORTED_MEDIA_TYPE"], [429, "RATE_LIMIT_EXCEEDED"],
  ])("maps %i to %s instead of INTERNAL_ERROR", async (status, code) => {
    process.env.NODE_ENV = "production";
    const res = await build().inject({ method: "GET", url: `/s/${status}` });
    expect(res.statusCode).toBe(status);
    expect(res.json().error.code).toBe(code);
  });

  it("passes 4xx messages through (client-facing)", async () => {
    process.env.NODE_ENV = "production";
    const res = await build().inject({ method: "GET", url: "/s/409" });
    expect(res.json().error.message).toBe("client problem 409");
  });

  it("returns VALIDATION_ERROR for schema failures", async () => {
    const res = await build().inject({ method: "POST", url: "/validated", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.requestId).toBeTruthy();
  });

  it("not-found handler uses the same envelope", async () => {
    const res = await build().inject({ method: "GET", url: "/nope?x=1" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false, error: { code: "NOT_FOUND", message: "Route GET /nope not found" } });
  });

  it("honours a sane inbound x-request-id and replaces an unsafe one", async () => {
    const app = build();
    const ok = await app.inject({ method: "GET", url: "/nope", headers: { "x-request-id": "lb-abc123-XYZ" } });
    expect(ok.headers["x-request-id"]).toBe("lb-abc123-XYZ");
    const bad = await app.inject({ method: "GET", url: "/nope", headers: { "x-request-id": "evil\" <script>" } });
    expect(bad.headers["x-request-id"]).not.toContain("<");
    expect(String(bad.headers["x-request-id"])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("codeForStatus falls back sensibly", () => {
    expect(codeForStatus(418)).toBe("BAD_REQUEST");
    expect(codeForStatus(599)).toBe("INTERNAL_ERROR");
  });
});
