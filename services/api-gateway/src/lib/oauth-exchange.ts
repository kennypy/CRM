/**
 * OAuth token exchange + AES-256-GCM encryption helpers.
 * Used by Gmail, Outlook, and Slack OAuth flows.
 */

export { encryptSecret as encrypt, decryptSecret as decrypt } from "@nexcrm/service-common/secret-crypto";

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
