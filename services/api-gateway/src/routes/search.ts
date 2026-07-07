/**
 * Global cross-object search — one query, results grouped by object type.
 *
 * Fans out to graph-core's contacts/companies/deals list endpoints (each of
 * which supports a `search` predicate) and folds the responses into a single
 * typed result set the UI can render as a "jump to record" palette. Contacts
 * and leads share the Person node, split here by the `is_lead` flag.
 *
 * GET /api/v1/search?q=acme&limit=5
 */

import type { FastifyInstance } from "fastify";
import { internalFetch, internalIdentityHeaders } from "../lib/internal-fetch";
import { requireCrmRead } from "../middleware/scope";
import { GRAPH_CORE_URL } from "../lib/service-urls";

interface SearchResult {
  type: "contact" | "lead" | "company" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any[]> {
  try {
    const res = await internalFetch(url, { headers });
    if (!res.ok) return [];
    const body = await res.json().catch(() => ({}));
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

export async function searchRoutes(server: FastifyInstance) {
  server.get("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as Record<string, string>;
    const term = (q.q ?? "").trim();
    const perType = Math.min(Math.max(parseInt(q.limit ?? "5", 10) || 5, 1), 20);

    if (term.length < 2) {
      return reply.send({ success: true, data: { results: [], total: 0, query: term } });
    }

    const headers = internalIdentityHeaders(request);
    const enc = encodeURIComponent(term);
    const base = `${GRAPH_CORE_URL}/api/v1`;

    // Fan out concurrently. Contacts endpoint returns contacts + leads together;
    // we request a larger slice so both groups have room after the split.
    const [people, companies, deals] = await Promise.all([
      fetchJson(`${base}/contacts?tenantId=${tenantId}&search=${enc}&limit=${perType * 2}`, headers),
      fetchJson(`${base}/companies?tenantId=${tenantId}&search=${enc}&limit=${perType}`, headers),
      fetchJson(`${base}/deals?tenantId=${tenantId}&search=${enc}&limit=${perType}`, headers),
    ]);

    const results: SearchResult[] = [];

    const contacts = people.filter((p) => !p.isLead && !p.is_lead);
    const leads = people.filter((p) => p.isLead || p.is_lead);

    const personName = (p: any) =>
      `${p.firstName ?? p.first_name ?? ""} ${p.lastName ?? p.last_name ?? ""}`.trim() || p.email || "Unnamed";
    const personCompany = (p: any) => p.companyName ?? p.company_name ?? p.title ?? p.email ?? null;

    for (const p of contacts.slice(0, perType)) {
      results.push({ type: "contact", id: p.id, title: personName(p), subtitle: personCompany(p), href: `/contacts/${p.id}` });
    }
    for (const p of leads.slice(0, perType)) {
      results.push({ type: "lead", id: p.id, title: personName(p), subtitle: personCompany(p), href: `/leads?focus=${p.id}` });
    }
    for (const c of companies.slice(0, perType)) {
      results.push({
        type: "company",
        id: c.id,
        title: c.name ?? "Unnamed",
        subtitle: c.domain ?? c.industry ?? null,
        href: `/companies/${c.id}`,
      });
    }
    for (const d of deals.slice(0, perType)) {
      const stage = d.stage ? String(d.stage).replace(/_/g, " ") : null;
      const company = d.companyName ?? d.company_name ?? null;
      results.push({
        type: "deal",
        id: d.id,
        title: d.name ?? "Unnamed deal",
        subtitle: [company, stage].filter(Boolean).join(" · ") || null,
        href: `/pipeline?focus=${d.id}`,
      });
    }

    return reply.send({ success: true, data: { results, total: results.length, query: term } });
  });
}
