import { describe, it, expect } from "vitest";
import { isOverLimit, isAtCapacity, emailDomain } from "../lib/signup-guard";
import { isDisposableDomain } from "../lib/disposable-domains";

describe("rate-limit decision (isOverLimit)", () => {
  it("allows when no counter exists yet", () => {
    expect(isOverLimit(null, 5)).toBe(false);
  });

  it("allows below the limit", () => {
    expect(isOverLimit("4", 5)).toBe(false);
    expect(isOverLimit(4, 5)).toBe(false);
  });

  it("blocks at and above the limit", () => {
    expect(isOverLimit("5", 5)).toBe(true);
    expect(isOverLimit(6, 5)).toBe(true);
  });

  it("allows on a garbage counter value rather than locking everyone out", () => {
    expect(isOverLimit("not-a-number", 5)).toBe(false);
  });
});

describe("global sandbox capacity (isAtCapacity)", () => {
  it("allows below the cap", () => {
    expect(isAtCapacity(199, 200)).toBe(false);
  });

  it("blocks at and above the cap", () => {
    expect(isAtCapacity(200, 200)).toBe(true);
    expect(isAtCapacity(250, 200)).toBe(true);
  });

  it("blocks everything with a zero cap", () => {
    expect(isAtCapacity(0, 0)).toBe(true);
  });
});

describe("emailDomain", () => {
  it("extracts the lowercase domain", () => {
    expect(emailDomain("Jane.Doe@Example.COM")).toBe("example.com");
  });

  it("uses the last @ (quoted-local-part edge case)", () => {
    expect(emailDomain('"a@b"@real.com')).toBe("real.com");
  });

  it("returns empty for malformed addresses", () => {
    expect(emailDomain("no-at-sign")).toBe("");
    expect(emailDomain("trailing@")).toBe("");
  });
});

describe("disposable domain blocking", () => {
  it("blocks known disposable providers", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("guerrillamail.com")).toBe(true);
    expect(isDisposableDomain("yopmail.com")).toBe(true);
    expect(isDisposableDomain("temp-mail.org")).toBe(true);
  });

  it("blocks subdomains of disposable providers", () => {
    expect(isDisposableDomain("anything.mailinator.com")).toBe(true);
    expect(isDisposableDomain("a.b.yopmail.com")).toBe(true);
  });

  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(isDisposableDomain("MAILINATOR.COM")).toBe(true);
    expect(isDisposableDomain("mailinator.com.")).toBe(true);
  });

  it("allows normal work and consumer domains", () => {
    expect(isDisposableDomain("gmail.com")).toBe(false);
    expect(isDisposableDomain("nexcrm.io")).toBe(false);
    expect(isDisposableDomain("example.co.uk")).toBe(false);
  });

  it("does not block a lookalike that merely contains a blocked name", () => {
    expect(isDisposableDomain("notmailinator.com")).toBe(false);
  });

  it("handles empty input", () => {
    expect(isDisposableDomain("")).toBe(false);
  });
});
