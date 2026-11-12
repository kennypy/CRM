/**
 * Display fields for graph records referenced from relational tables.
 * Goes through graph-core (the only service with graph access).
 */
import { internalFetch } from "./internal-fetch";
import { GRAPH_CORE_URL } from "./service-urls";

export interface ContactRef { id: string; firstName?: string; lastName?: string; email?: string; title?: string; ownerId?: string; companyId?: string; companyName?: string }
export interface DealRef { id: string; name?: string; stage?: string; value?: number; currency?: string; ownerId?: string; companyId?: string; companyName?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function lookupGraphRecords(
  tenantId: string, ids: { contactIds?: string[]; dealIds?: string[] },
): Promise<{ contacts: Map<string, ContactRef>; deals: Map<string, DealRef> }> {
  const contactIds = [...new Set((ids.contactIds ?? []).filter((x) => UUID.test(x)))].slice(0, 1000);
  const dealIds = [...new Set((ids.dealIds ?? []).filter((x) => UUID.test(x)))].slice(0, 1000);
  const empty = { contacts: new Map<string, ContactRef>(), deals: new Map<string, DealRef>() };
  if (!contactIds.length && !dealIds.length) return empty;
  try {
    const res = await internalFetch(`${GRAPH_CORE_URL}/internal/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({ tenantId, contactIds, dealIds }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return empty;
    const { data } = (await res.json()) as { data: { contacts: ContactRef[]; deals: DealRef[] } };
    return { contacts: new Map(data.contacts.map((c) => [c.id, c])), deals: new Map(data.deals.map((d) => [d.id, d])) };
  } catch {
    return empty;
  }
}
