/**
 * Data deduplication routes
 *
 * GET  /api/v1/admin/duplicates?entity_type=contact  — find potential duplicates
 * POST /api/v1/admin/duplicates/dismiss              — dismiss a duplicate pair
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, readPool } from "../db";
import { requireManager } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";
import { GRAPH_CORE_URL as GRAPH_CORE } from "../lib/service-urls";
import { internalFetch } from "../lib/internal-fetch";

interface DuplicatePair {
  id1: string;
  id2: string;
  name1: string;
  name2: string;
  email1: string;
  email2: string;
  confidence: number;
  reason: string;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").replace(/^0+/, "");
}

async function findContactDuplicates(tenantId: string): Promise<DuplicatePair[]> {
  // Fetch all contacts from graph-core
  const res = await internalFetch(`${GRAPH_CORE}/contacts?tenantId=${tenantId}&limit=5000`);
  if (!res.ok) return [];
  const json = await res.json() as { data: Array<Record<string, any>> };
  const contacts = json.data ?? [];

  const pairs: DuplicatePair[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i];
      const b = contacts[j];
      const pairKey = [a.id, b.id].sort().join(":");
      if (seen.has(pairKey)) continue;

      let confidence = 0;
      const reasons: string[] = [];

      // Exact email match (highest confidence)
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
        confidence += 90;
        reasons.push("Same email");
      }

      // Name similarity
      const nameA = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim().toLowerCase();
      const nameB = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim().toLowerCase();
      if (nameA && nameB) {
        if (nameA === nameB) {
          confidence += 50;
          reasons.push("Exact name match");
        } else {
          const dist = levenshtein(nameA, nameB);
          const maxLen = Math.max(nameA.length, nameB.length);
          const similarity = 1 - dist / maxLen;
          if (similarity >= 0.8) {
            confidence += Math.round(similarity * 40);
            reasons.push("Similar name");
          }
        }
      }

      // Phone match
      if (a.phone && b.phone) {
        const pa = normalizePhone(a.phone);
        const pb = normalizePhone(b.phone);
        if (pa === pb && pa.length > 5) {
          confidence += 40;
          reasons.push("Same phone");
        }
      }

      // Cap at 100
      confidence = Math.min(confidence, 100);

      if (confidence >= 50) {
        seen.add(pairKey);
        pairs.push({
          id1: a.id,
          id2: b.id,
          name1: `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim(),
          name2: `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim(),
          email1: a.email ?? "",
          email2: b.email ?? "",
          confidence,
          reason: reasons.join(", "),
        });
      }
    }
  }

  // Sort by confidence descending
  pairs.sort((a, b) => b.confidence - a.confidence);
  return pairs.slice(0, 100); // limit results
}

async function findCompanyDuplicates(tenantId: string): Promise<DuplicatePair[]> {
  const res = await internalFetch(`${GRAPH_CORE}/companies?tenantId=${tenantId}&limit=5000`);
  if (!res.ok) return [];
  const json = await res.json() as { data: Array<Record<string, any>> };
  const companies = json.data ?? [];

  const pairs: DuplicatePair[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const a = companies[i];
      const b = companies[j];
      const pairKey = [a.id, b.id].sort().join(":");
      if (seen.has(pairKey)) continue;

      let confidence = 0;
      const reasons: string[] = [];

      // Domain match
      if (a.domain && b.domain && a.domain.toLowerCase() === b.domain.toLowerCase()) {
        confidence += 90;
        reasons.push("Same domain");
      }

      // Name similarity
      const nameA = (a.name ?? "").toLowerCase();
      const nameB = (b.name ?? "").toLowerCase();
      if (nameA && nameB) {
        if (nameA === nameB) {
          confidence += 60;
          reasons.push("Exact name match");
        } else {
          const dist = levenshtein(nameA, nameB);
          const maxLen = Math.max(nameA.length, nameB.length);
          const similarity = 1 - dist / maxLen;
          if (similarity >= 0.8) {
            confidence += Math.round(similarity * 40);
            reasons.push("Similar name");
          }
        }
      }

      confidence = Math.min(confidence, 100);

      if (confidence >= 50) {
        seen.add(pairKey);
        pairs.push({
          id1: a.id,
          id2: b.id,
          name1: a.name ?? "",
          name2: b.name ?? "",
          email1: a.domain ?? "",
          email2: b.domain ?? "",
          confidence,
          reason: reasons.join(", "),
        });
      }
    }
  }

  pairs.sort((a, b) => b.confidence - a.confidence);
  return pairs.slice(0, 100);
}

export async function dedupRoutes(server: FastifyInstance) {
  server.addHook("onRequest", requireManager);
  server.addHook("preHandler", denyApiKeys);

  server.get("/duplicates", async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const entityType = q.entity_type ?? "contact";

    const pairs = entityType === "company"
      ? await findCompanyDuplicates(tenantId)
      : await findContactDuplicates(tenantId);

    return reply.send({ success: true, data: pairs });
  });

  server.post("/duplicates/dismiss", async (request, reply) => {
    const { tenantId } = request.user;
    const body = request.body as { id1: string; id2: string; entity_type: string };

    // Store dismissed pairs so they don't show up again
    await pool.query(
      `INSERT INTO entity_tags (tenant_id, entity_type, entity_id, tag)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [tenantId, `dedup_dismissed`, body.id1, `${body.id1}:${body.id2}`]
    ).catch(() => {});

    return reply.send({ success: true });
  });
}
