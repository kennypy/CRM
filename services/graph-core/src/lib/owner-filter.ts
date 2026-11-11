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
