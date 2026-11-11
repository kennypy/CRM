/**
 * List-endpoint visibility for proxied graph entities.
 *
 * Strips any client-supplied visibility params (they are trusted downstream),
 * applies ?scope=mine|team|all, and — under a Private sharing default —
 * restricts results to records owned by the caller, their subordinates and
 * teammates (or deals they are on the opportunity team of).
 */
import type { FastifyRequest } from "fastify";
import { pool } from "../db";
import { getSubordinateIds, visibleOwnerIdsForList } from "./visibility";

const RESERVED = new Set(["visibleOwnerIds", "visibleDealIds", "scope"]);

export async function applyListVisibility(
  request: FastifyRequest,
  entityType: "deal" | "contact" | "company",
): Promise<void> {
  const { tenantId, sub: userId, role } = request.user;
  const [path, qs = ""] = request.url.split("?");
  const params = new URLSearchParams(qs);
  const scope = params.get("scope") ?? "all";
  for (const k of RESERVED) params.delete(k);

  let owners: string[] | null = await visibleOwnerIdsForList(tenantId, userId, role, entityType);

  if (scope === "mine") {
    owners = [userId];
  } else if (scope === "team") {
    const team = [userId, ...(await getSubordinateIds(tenantId, userId))];
    owners = owners ? team.filter((id) => owners!.includes(id)) : team;
  }

  if (owners) {
    params.set("visibleOwnerIds", owners.join(","));
    if (entityType === "deal" && scope !== "mine") {
      const { rows } = await pool.query(
        `SELECT deal_id FROM deal_team_members WHERE tenant_id = $1 AND user_id = $2 LIMIT 2000`,
        [tenantId, userId],
      );
      if (rows.length) params.set("visibleDealIds", rows.map((r) => r.deal_id).join(","));
    }
  }
  const next = params.toString();
  (request.raw as { url?: string }).url = next ? `${path}?${next}` : path;
}
