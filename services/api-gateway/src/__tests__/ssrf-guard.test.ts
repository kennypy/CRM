import { describe, it, expect } from "vitest";
import { assertSafeUrl, SsrfBlockedError } from "../lib/ssrf-guard";

describe("assertSafeUrl", () => {
  const opts = { protocols: ["https:", "http:"] };

  it("blocks loopback IPv4", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/x", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks the cloud metadata address", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data/", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks RFC1918 ranges", async () => {
    await expect(assertSafeUrl("http://10.1.2.3/x", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafeUrl("http://192.168.0.5/x", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafeUrl("http://172.16.9.9/x", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks IPv6 loopback and unique-local", async () => {
    await expect(assertSafeUrl("http://[::1]/x", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafeUrl("http://[fd00::1]/x", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks non-http(s) schemes", async () => {
    await expect(assertSafeUrl("file:///etc/passwd", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafeUrl("gopher://127.0.0.1", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects embedded credentials", async () => {
    await expect(assertSafeUrl("https://user:pass@example.com/x", opts)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("defaults to https-only when no protocols given", async () => {
    await expect(assertSafeUrl("http://93.184.216.34/x")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("allows a public literal IP", async () => {
    const res = await assertSafeUrl("https://93.184.216.34/x", opts);
    expect(res.address).toBe("93.184.216.34");
  });

  it("honors the private-host opt-in env var", async () => {
    process.env.TEST_ALLOW_PRIVATE = "true";
    const res = await assertSafeUrl("http://127.0.0.1:11434/v1", {
      protocols: ["http:"],
      allowPrivateEnvVar: "TEST_ALLOW_PRIVATE",
    });
    expect(res.address).toBe("127.0.0.1");
    delete process.env.TEST_ALLOW_PRIVATE;
  });
});
