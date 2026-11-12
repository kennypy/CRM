import { describe, expect, it } from "vitest";
import { canManage, connectPath, parseCallbackParams, stripCallbackParams } from "@/lib/integrations";

describe("integrations helpers", () => {
  it("parses OAuth callback outcomes", () => {
    expect(parseCallbackParams(new URLSearchParams("tab=integrations&gmail=connected")))
      .toEqual({ provider: "gmail", outcome: "connected", reason: null });
    expect(parseCallbackParams(new URLSearchParams("tab=integrations&zoom=error&reason=invalid_state")))
      .toEqual({ provider: "zoom", outcome: "error", reason: "invalid_state" });
  });

  it("ignores unknown providers/values and unsafe reasons", () => {
    expect(parseCallbackParams(new URLSearchParams("tab=integrations&stripe=connected"))).toBeNull();
    expect(parseCallbackParams(new URLSearchParams("gmail=maybe"))).toBeNull();
    expect(parseCallbackParams(new URLSearchParams("slack=error&reason=<script>"))?.reason).toBeNull();
  });

  it("strips callback params but keeps the tab", () => {
    expect(stripCallbackParams(new URLSearchParams("tab=integrations&outlook=error&reason=x"))).toBe("?tab=integrations");
    expect(stripCallbackParams(new URLSearchParams("gmail=connected"))).toBe("");
  });

  it("builds JSON-mode connect paths", () => {
    expect(connectPath("slack")).toBe("/api/v1/integrations/slack/connect?format=json");
  });

  it("workspace integrations are admin-managed; mailboxes are per user", () => {
    expect(canManage({ scope: "user" }, false)).toBe(true);
    expect(canManage({ scope: "workspace" }, false)).toBe(false);
    expect(canManage({ scope: "workspace" }, true)).toBe(true);
  });
});
