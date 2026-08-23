/**
 * Sandbox provisioning: ask graph-core to seed the shared CRM sample data
 * into a freshly verified sandbox tenant.
 *
 * Called fire-and-forget from the verify-email flow — the HTTP response never
 * blocks on ~100 graph writes. The UI tolerates empty-then-populated.
 */

const seededTenants = new Set<string>();

export async function requestSampleSeed(tenantId: string, ownerUserId: string): Promise<void> {
  // In-process double-call guard (e.g. two verify clicks racing the UPDATE).
  if (seededTenants.has(tenantId)) return;
  seededTenants.add(tenantId);

  const base = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";
  const url = `${base}/internal/sample-data?tenantId=${encodeURIComponent(tenantId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-token": process.env.INTERNAL_SERVICE_SECRET ?? "",
    },
    body: JSON.stringify({ tenantId, ownerUserId }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    seededTenants.delete(tenantId); // allow a retry on the next verification attempt
    const text = await res.text().catch(() => "");
    throw new Error(`graph-core sample-data returned ${res.status}: ${text.slice(0, 200)}`);
  }
}
