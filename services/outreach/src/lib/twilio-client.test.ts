/**
 * Tests for Twilio webhook URL reconstruction + signature verification
 * (H-OUT3) and voice-token signing-key selection (M-OUT3).
 */
import { describe, it, expect, afterEach } from "vitest";
import twilio from "twilio";
import {
  reconstructTwilioUrl,
  verifyTwilioSignature,
  generateVoiceToken,
} from "./twilio-client";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("reconstructTwilioUrl", () => {
  const rawUrl = "/calls/webhooks/twilio/status?tenantId=abc&Foo=bar";

  it("uses x-forwarded-proto/x-forwarded-host with the verbatim path+query", () => {
    const url = reconstructTwilioUrl(rawUrl, {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "api.nexcrm.example",
      host: "internal:4003",
    });
    expect(url).toBe("https://api.nexcrm.example/calls/webhooks/twilio/status?tenantId=abc&Foo=bar");
  });

  it("falls back to the host header when no forwarded host is present", () => {
    const url = reconstructTwilioUrl(rawUrl, { host: "api.nexcrm.example" });
    expect(url).toBe("https://api.nexcrm.example/calls/webhooks/twilio/status?tenantId=abc&Foo=bar");
  });

  it("falls back to the configured public base when no host headers exist", () => {
    process.env.TWILIO_WEBHOOK_PUBLIC_URL = "https://hooks.nexcrm.example/";
    const url = reconstructTwilioUrl(rawUrl, {});
    expect(url).toBe("https://hooks.nexcrm.example/calls/webhooks/twilio/status?tenantId=abc&Foo=bar");
  });

  it("takes only the first value of a comma-joined forwarded header", () => {
    const url = reconstructTwilioUrl(rawUrl, {
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "api.nexcrm.example, evil.example",
    });
    expect(url).toBe("https://api.nexcrm.example/calls/webhooks/twilio/status?tenantId=abc&Foo=bar");
  });
});

describe("verifyTwilioSignature", () => {
  const authToken = "twilio-auth-token-fixture";
  // The real public URL Twilio posts to, including query string.
  const signedUrl = "https://api.nexcrm.example/calls/webhooks/twilio/status?tenantId=abc";
  const params = {
    AccountSid: "AC00000000000000000000000000000000",
    CallSid: "CA11111111111111111111111111111111",
    CallStatus: "completed",
    CallDuration: "42",
  };
  // Genuine signature computed by the Twilio SDK over signedUrl + params.
  const goodSig = twilio.getExpectedTwilioSignature(authToken, signedUrl, params);

  it("accepts a genuine signature over the exact reconstructed URL", () => {
    const url = reconstructTwilioUrl(
      "/calls/webhooks/twilio/status?tenantId=abc",
      { "x-forwarded-proto": "https", "x-forwarded-host": "api.nexcrm.example" },
    );
    expect(url).toBe(signedUrl);
    expect(verifyTwilioSignature(authToken, goodSig, url, params)).toBe(true);
  });

  it("rejects when the URL is forged (attacker-controlled query mismatch)", () => {
    const forged = "https://api.nexcrm.example/calls/webhooks/twilio/status?tenantId=victim";
    expect(verifyTwilioSignature(authToken, goodSig, forged, params)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyTwilioSignature(authToken, "", signedUrl, params)).toBe(false);
  });

  it("rejects a wrong auth token", () => {
    expect(verifyTwilioSignature("other-token", goodSig, signedUrl, params)).toBe(false);
  });
});

describe("generateVoiceToken signing key (M-OUT3)", () => {
  const creds = {
    accountSid: "AC00000000000000000000000000000000",
    authToken: "the-account-auth-token",
    fromNumber: "+15555550100",
  };

  function decodeHeaderAndPayload(jwt: string) {
    const [h, p] = jwt.split(".");
    return {
      header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
    };
  }

  it("signs with the configured API Key SID, not the account SID", () => {
    process.env.NODE_ENV = "production";
    process.env.TWILIO_API_KEY_SID = "SKaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.TWILIO_API_KEY_SECRET = "api-key-secret-value";

    const jwt = generateVoiceToken({
      creds,
      twimlAppSid: "APbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      identity: "user-123",
    });
    const { header, payload } = decodeHeaderAndPayload(jwt);
    // `iss` is the signing key (API Key SID); `sub` is the account SID.
    expect(header.kid ?? payload.iss).toBe("SKaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(payload.sub).toBe(creds.accountSid);
    expect(payload.grants.identity).toBe("user-123");
  });

  it("prefers per-tenant API key over env", () => {
    process.env.NODE_ENV = "production";
    process.env.TWILIO_API_KEY_SID = "SKenvenvenvenvenvenvenvenvenvenven";
    process.env.TWILIO_API_KEY_SECRET = "env-secret";

    const jwt = generateVoiceToken({
      creds: { ...creds, apiKeySid: "SKtenanttenanttenanttenanttenantte", apiKeySecret: "tenant-secret" },
      twimlAppSid: "APbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      identity: "user-123",
    });
    const { header, payload } = decodeHeaderAndPayload(jwt);
    expect(header.kid ?? payload.iss).toBe("SKtenanttenanttenanttenanttenantte");
  });

  it("refuses to mint a token in production without an API key", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TWILIO_API_KEY_SID;
    delete process.env.TWILIO_API_KEY_SECRET;
    expect(() =>
      generateVoiceToken({
        creds,
        twimlAppSid: "APbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        identity: "user-123",
      }),
    ).toThrow(/API Key/i);
  });
});
