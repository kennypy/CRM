/**
 * Cypher map serialisation for Apache AGE.
 *
 * AGE requires bare identifier keys in map literals ({id: '...'}) —
 * JSON.stringify's double-quoted keys are a syntax error, and a JSON string
 * cast with ::agtype is rejected by `SET n += ...` ("SET clause expects a map").
 *
 * SECURITY: these helpers interpolate values straight into the Cypher text.
 * That is acceptable only for trusted, static data (the demo seed). If they
 * are ever reused for user input, switch to parameterised cypher() calls
 * instead.
 */

export function escapeCypherString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function toCypherValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return `'${escapeCypherString(v)}'`;
  // Nested objects / arrays: store as a single-quoted JSON string.
  return `'${escapeCypherString(JSON.stringify(v))}'`;
}

export function toCypherMap(props: Record<string, unknown>): string {
  const entries = Object.entries(props).map(([k, v]) => {
    const key = k.replace(/[^A-Za-z0-9_]/g, "_");
    return `${key}: ${toCypherValue(v)}`;
  });
  return `{${entries.join(", ")}}`;
}
