/**
 * Provider push webhooks for the ingestion service.
 *
 *   POST /ingestion/gmail/push             Gmail (Google Pub/Sub push)
 *   POST /ingestion/outlook/notifications  Microsoft Graph change notifications
 *   POST /ingestion/gcal/notifications     Google Calendar push channel
 *
 * The ingestion connectors register `${API_GATEWAY_URL}/ingestion/...` with
 * Google and Microsoft, but the gateway never served those paths (401), and the
 * ingestion service itself only accepts calls carrying the internal service
 * token — so no provider notification could ever arrive and mail/calendar sync
 * never ran in real time.
 *
 * These routes are public (the provider cannot hold our JWT). Authentication of
 * the notification is done by the ingestion service: the Pub/Sub OIDC token for
 * Gmail, the per-subscription clientState for Outlook, and the per-channel token
 * for Google Calendar. The gateway forwards only the headers those checks need.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { internalFetch } from "../lib/internal-fetch";
import { INGESTION_URL } from "../lib/service-urls";

const FORWARD_HEADERS = [
  "authorization",
  "x-goog-resource-state", "x-goog-channel-id", "x-goog-channel-token",
  "x-goog-resource-id", "x-goog-message-number",
];

function forward(upstreamPath: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const qs = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
    const headers: Record<string, string> = { "content-type": "application/json" };
    for (const h of FORWARD_HEADERS) {
      const v = request.headers[h];
      if (typeof v === "string") headers[h] = v;
    }
    try {
      const res = await internalFetch(`${INGESTION_URL}${upstreamPath}${qs}`, {
        method: "POST",
        headers,
        body: JSON.stringify(request.body ?? {}),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      return reply.status(res.status).type(res.headers.get("content-type") ?? "text/plain").send(text);
    } catch (err) {
      request.log.error({ err, upstreamPath }, "ingestion_webhook.upstream_error");
      // 503 makes the provider retry rather than drop the notification.
      return reply.status(503).send({ success: false, error: { code: "UPSTREAM_UNAVAILABLE" } });
    }
  };
}

export const INGESTION_WEBHOOK_PATHS = [
  "/ingestion/gmail/push",
  "/ingestion/outlook/notifications",
  "/ingestion/gcal/notifications",
];

export async function ingestionWebhookRoutes(server: FastifyInstance) {
  const config = { rateLimit: { max: 600, timeWindow: "1 minute" } };
  server.post("/gmail/push", { config }, forward("/gmail/push"));
  server.post("/outlook/notifications", { config }, forward("/outlook/notifications"));
  server.post("/gcal/notifications", { config }, forward("/gcal/notifications"));
}
