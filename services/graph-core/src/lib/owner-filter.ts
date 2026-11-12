import { z } from "zod";

/**
 * Comma-separated UUID list in a query string (e.g. visibleOwnerIds=a,b,c).
 * Capped so a pathological hierarchy cannot build an unbounded Cypher IN list.
 */
export const OwnerIdList = z
  .string()
  .max(40 * 2000)
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid()).max(2000));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Cypher list LITERAL of UUIDs, e.g. ['a…','b…'], for `x.prop IN <list>`.
 *
 * Why not a parameter: AGE compiles `x.prop IN $param` to agtype_in_operator(),
 * which no index can serve — the filter then runs over every record of the
 * workspace. A literal list compiles to `= ANY(...)` and uses the btree
 * expression index (migration 065). Every element is checked against a strict
 * UUID pattern, so nothing user-controlled reaches the query text.
 */
export function uuidListLiteral(ids: readonly string[]): string {
  for (const id of ids) {
    if (!UUID.test(id)) throw new Error("uuidListLiteral: not a UUID");
  }
  return `[${ids.map((id) => `'${id.toLowerCase()}'`).join(", ")}]`;
}

/**
 * Tiny in-process TTL cache for whole-workspace counts and aggregates. Those
 * cost O(records in the workspace) and are requested by every list/dashboard
 * load; a few seconds of staleness in a total is invisible to users.
 */
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  if (cache.size > 5000) cache.clear();
  // Cache the PROMISE (single-flight): concurrent requests for the same total
  // share one query instead of each starting their own.
  const value = fn().catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { at: now, value });
  return value;
}
