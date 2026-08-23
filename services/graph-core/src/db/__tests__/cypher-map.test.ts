import { describe, it, expect } from "vitest";
import { escapeCypherString, toCypherValue, toCypherMap } from "../cypher-map";

// AGE 1.6.0 does not accept JSON-style maps ({"key": ...}) nor `ON CREATE SET`
// — these tests pin the serialisation contract the demo seed relies on.
describe("toCypherMap", () => {
  it("emits bare identifier keys, not JSON double-quoted keys", () => {
    expect(toCypherMap({ id: "t1" })).toBe("{id: 't1'}");
  });

  it("rewrites non-identifier characters in keys to underscores", () => {
    expect(toCypherMap({ "weird-key!": 1 })).toBe("{weird_key_: 1}");
  });

  it("emits numbers and booleans bare", () => {
    expect(toCypherMap({ n: 42, f: 1.5, yes: true, no: false }))
      .toBe("{n: 42, f: 1.5, yes: true, no: false}");
  });

  it("emits NULL for null and undefined", () => {
    expect(toCypherMap({ a: null, b: undefined })).toBe("{a: NULL, b: NULL}");
  });

  it("single-quotes strings and escapes quotes and backslashes", () => {
    expect(toCypherValue("Dmitri: 'Love the product'"))
      .toBe("'Dmitri: \\'Love the product\\''");
    expect(toCypherValue("back\\slash")).toBe("'back\\\\slash'");
  });

  it("serialises nested objects and arrays to a single-quoted JSON string", () => {
    expect(toCypherMap({ flags: ["a", "b"] })).toBe("{flags: '[\"a\",\"b\"]'}");
    expect(toCypherMap({ meta: { k: 1 } })).toBe("{meta: '{\"k\":1}'}");
  });

  it("emits NULL for non-finite numbers rather than invalid literals", () => {
    expect(toCypherValue(NaN)).toBe("NULL");
    expect(toCypherValue(Infinity)).toBe("NULL");
  });

  it("round-trips a realistic node property map without JSON-style keys", () => {
    const map = toCypherMap({
      id: "d0000000-0000-0000-0000-000000000301",
      tenant_id: "d0000000-0000-0000-0000-000000000001",
      name: "Meridian — Revenue Intelligence Platform",
      value: 285000,
      is_expansion: false,
      risk_flags: JSON.stringify(["incomplete_buying_group"]),
    });
    expect(map).not.toMatch(/"\w+":/); // no JSON-style keys
    expect(map).toContain("value: 285000");
    expect(map).toContain("is_expansion: false");
  });
});
