/**
 * Instance capability manifest — which product capabilities this deployment
 * actually has, derived from configuration (never from probing services).
 *
 * The demo compose file deliberately omits ingestion, ingestion-worker,
 * ai-engine, ai-worker, and minio. Any UI that renders those features anyway
 * is lying to the user, so the deployment declares its missing services via
 * DISABLED_SERVICES (comma-separated) and the web app hides or visibly
 * disables everything that depends on them.
 *
 * Service → capability mapping:
 *   ingestion        → activity_ingestion (email/calendar auto-capture, integration sync)
 *   ai-engine        → ai_scoring (Reality Score recompute, review queue AI, forecasting AI)
 *   minio            → file_attachments (file storage)
 *   semantic-search  → semantic_search (pgvector population — done by the absent workers)
 *
 * Unset DISABLED_SERVICES → everything enabled (full-stack default).
 */

export interface CapabilityManifest {
  activity_ingestion: boolean;
  ai_scoring: boolean;
  file_attachments: boolean;
  semantic_search: boolean;
}

const SERVICE_CAPABILITIES: Record<string, keyof CapabilityManifest> = {
  "ingestion":       "activity_ingestion",
  "ai-engine":       "ai_scoring",
  "minio":           "file_attachments",
  "semantic-search": "semantic_search",
};

export function getCapabilityManifest(
  disabledServicesEnv: string | undefined = process.env.DISABLED_SERVICES,
): CapabilityManifest {
  const manifest: CapabilityManifest = {
    activity_ingestion: true,
    ai_scoring: true,
    file_attachments: true,
    semantic_search: true,
  };

  for (const raw of (disabledServicesEnv ?? "").split(",")) {
    const service = raw.trim().toLowerCase();
    if (!service) continue;
    const capability = SERVICE_CAPABILITIES[service];
    if (capability) manifest[capability] = false;
  }

  return manifest;
}
