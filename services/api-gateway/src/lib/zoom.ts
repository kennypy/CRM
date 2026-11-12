/**
 * Zoom integration plumbing.
 *
 * Fixes a chain that never worked end to end:
 *   - OAuth callback stored the raw authorization CODE as the access token
 *     (never exchanged, unencrypted) and had no CSRF state;
 *   - the webhook never answered Zoom's endpoint.url_validation challenge, so
 *     Zoom would not enable it;
 *   - recording.completed webhooks carry a transcript download URL, not the
 *     text, but the AI summariser only read `transcript_text` — every summary
 *     was empty;
 *   - /integrations/zoom/sync proxied to an ingestion route that didn't exist.
 */
import { createHmac } from "node:crypto";
import { servicePool } from "../db";
import { decryptTenantSecret, encryptTenantSecret } from "@nexcrm/service-common/tenant-crypto";

const ZOOM_API = "https://api.zoom.us/v2";

export function zoomRedirectUri(): string {
  return process.env.ZOOM_OAUTH_REDIRECT
    ?? `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/zoom/callback`;
}

export function urlValidationResponse(plainToken: string, secret: string) {
  return { plainToken, encryptedToken: createHmac("sha256", secret).update(plainToken).digest("hex") };
}

interface ZoomTokens { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scope?: string }

async function tokenRequest(params: Record<string, string>): Promise<ZoomTokens> {
  const basic = Buffer.from(`${process.env.ZOOM_CLIENT_ID ?? ""}:${process.env.ZOOM_CLIENT_SECRET ?? ""}`).toString("base64");
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Zoom token request failed: ${res.status} ${await res.text().catch(() => "")}`);
  const d = (await res.json()) as Record<string, unknown>;
  return {
    accessToken: d.access_token as string,
    refreshToken: (d.refresh_token as string) ?? null,
    expiresAt: d.expires_in ? new Date(Date.now() + Number(d.expires_in) * 1000) : null,
    scope: d.scope as string | undefined,
  };
}

export const exchangeZoomCode = (code: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: zoomRedirectUri() });

export async function storeZoomTokens(tenantId: string, userId: string, t: ZoomTokens): Promise<void> {
  await servicePool.query(
    `INSERT INTO oauth_tokens (tenant_id, user_id, provider, access_token, refresh_token, expires_at, scopes)
     VALUES ($1, $2, 'zoom', $3, $4, $5, $6)
     ON CONFLICT (tenant_id, user_id, provider)
     DO UPDATE SET access_token = $3, refresh_token = COALESCE($4, oauth_tokens.refresh_token),
                   expires_at = $5, updated_at = NOW()`,
    [tenantId, userId,
     await encryptTenantSecret(servicePool, tenantId, t.accessToken),
     t.refreshToken ? await encryptTenantSecret(servicePool, tenantId, t.refreshToken) : null,
     t.expiresAt?.toISOString() ?? null,
     t.scope ? t.scope.split(/[ ,]+/) : []],
  );
  await servicePool.query(
    `INSERT INTO integrations (tenant_id, user_id, provider, status, config)
     VALUES ($1, $2, 'zoom', 'active', '{}'::jsonb)
     ON CONFLICT (tenant_id, user_id, provider) DO UPDATE SET status = 'active', config = '{}'::jsonb, updated_at = NOW()`,
    [tenantId, userId],
  );
}

/** A valid access token for the tenant's Zoom connection (refreshing if needed). */
export async function getZoomAccessToken(tenantId: string): Promise<string | null> {
  const { rows: [row] } = await servicePool.query(
    `SELECT user_id, access_token, refresh_token, expires_at FROM oauth_tokens
      WHERE tenant_id = $1 AND provider = 'zoom' ORDER BY updated_at DESC LIMIT 1`,
    [tenantId],
  );
  if (!row) return null;
  const fresh = row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60_000;
  if (fresh) return decryptTenantSecret(servicePool, tenantId, row.access_token);
  if (!row.refresh_token) return null;
  const refresh = await decryptTenantSecret(servicePool, tenantId, row.refresh_token);
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  await storeZoomTokens(tenantId, row.user_id, t);
  return t.accessToken;
}

/** WebVTT → plain "Speaker: text" lines. */
export function vttToText(vtt: string): string {
  return vtt
    .split(/\r?\n/)
    .filter((l) => l.trim() && l.trim() !== "WEBVTT" && !/^\d+$/.test(l.trim()) && !/-->/.test(l))
    .join("\n")
    .slice(0, 200_000);
}

export async function downloadTranscript(downloadUrl: string, token: string): Promise<string> {
  const u = new URL(downloadUrl);
  if (!/(^|\.)zoom\.us$/i.test(u.hostname)) throw new Error("Refusing non-Zoom download host");
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Transcript download failed: ${res.status}`);
  return vttToText(await res.text());
}

interface RecordingFile { recording_type?: string; file_type?: string; download_url?: string; transcript_text?: string }

/**
 * Put transcript text onto recording.completed payloads so the meeting
 * summariser (ai-engine) actually has something to summarise. Uses the
 * webhook's own download_token when present, else the tenant's OAuth token.
 */
export async function enrichRecordingEvent(
  body: Record<string, any>,
  resolveTenantByHostEmail: (email: string) => Promise<string | null>,
): Promise<boolean> {
  if (body?.event !== "recording.completed") return false;
  const obj = body.payload?.object ?? {};
  const files: RecordingFile[] = obj.recording_files ?? [];
  const tf = files.find((f) => f.recording_type === "audio_transcript" || f.file_type === "TRANSCRIPT");
  if (!tf?.download_url || tf.transcript_text) return false;
  let token: string | null = body.download_token ?? null;
  if (!token && obj.host_email) {
    const tenantId = await resolveTenantByHostEmail(String(obj.host_email));
    if (tenantId) token = await getZoomAccessToken(tenantId).catch(() => null);
  }
  if (!token) return false;
  tf.recording_type = "audio_transcript";
  tf.transcript_text = await downloadTranscript(tf.download_url, token);
  return true;
}

/** Recent cloud recordings for the connected Zoom user, as webhook-shaped events. */
export async function listRecentRecordingEvents(tenantId: string, days = 14): Promise<Record<string, any>[]> {
  const token = await getZoomAccessToken(tenantId);
  if (!token) throw new Error("Zoom is not connected for this workspace");
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const res = await fetch(`${ZOOM_API}/users/me/recordings?from=${from}&page_size=100`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Zoom recordings request failed: ${res.status}`);
  const data = (await res.json()) as { meetings?: Record<string, any>[] };
  const events: Record<string, any>[] = [];
  for (const m of data.meetings ?? []) {
    const files: RecordingFile[] = m.recording_files ?? [];
    const tf = files.find((f) => f.file_type === "TRANSCRIPT" || f.recording_type === "audio_transcript");
    if (!tf?.download_url) continue;
    const text = await downloadTranscript(tf.download_url, token).catch(() => "");
    if (!text) continue;
    events.push({
      event: "recording.completed",
      payload: { object: {
        id: m.id, uuid: m.uuid, topic: m.topic, host_email: m.host_email, duration: m.duration,
        participant_list: [], recording_files: [{ recording_type: "audio_transcript", transcript_text: text }],
      } },
    });
  }
  return events;
}
