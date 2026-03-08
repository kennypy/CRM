/**
 * OAuth token exchange + AES-256-GCM encryption helpers.
 * Used by Gmail, Outlook, and Slack OAuth flows.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENCRYPTION_KEY = process.env.OAUTH_ENCRYPTION_KEY ?? "";

function getKey(): Buffer {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    throw new Error("OAUTH_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
  }
  return Buffer.from(ENCRYPTION_KEY, "hex");
}

/**
 * Encrypt a string with AES-256-GCM. Returns "iv:authTag:ciphertext" (all hex).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a string encrypted with encrypt().
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivHex, authTagHex, encHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

interface TokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope?: string;
  extra?: Record<string, unknown>;
}

/**
 * Exchange a Google OAuth code for tokens.
 */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<TokenResult> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google token exchange failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as Record<string, unknown>;
  return {
    accessToken:  data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? null,
    expiresAt:    data.expires_in
      ? new Date(Date.now() + (data.expires_in as number) * 1000)
      : null,
    scope: data.scope as string | undefined,
  };
}

/**
 * Exchange a Microsoft OAuth code for tokens.
 */
export async function exchangeOutlookCode(code: string, redirectUri: string): Promise<TokenResult> {
  const resp = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.MICROSOFT_CLIENT_ID ?? "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
      scope:         "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send offline_access",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Microsoft token exchange failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as Record<string, unknown>;
  return {
    accessToken:  data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? null,
    expiresAt:    data.expires_in
      ? new Date(Date.now() + (data.expires_in as number) * 1000)
      : null,
    scope: data.scope as string | undefined,
  };
}

/**
 * Exchange a Slack OAuth code for a bot token.
 */
export async function exchangeSlackCode(code: string, redirectUri: string): Promise<{
  botToken: string;
  botUserId: string;
  workspaceId: string;
  workspaceName: string;
}> {
  const resp = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      redirect_uri:  redirectUri,
    }),
  });

  const data = await resp.json() as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack OAuth failed: ${data.error}`);
  }

  return {
    botToken:      (data.access_token as string),
    botUserId:     ((data.bot_user_id ?? (data as any).authed_user?.id) as string),
    workspaceId:   ((data.team as any)?.id as string),
    workspaceName: ((data.team as any)?.name as string),
  };
}
