/**
 * Okta OIDC client helpers (server-side only — used by the SSO route handlers).
 *
 * The web app acts as the confidential OIDC client: it drives the
 * authorization-code flow against Okta, then hands the verified identity to the
 * auth service's internal /sso-provision endpoint to mint app tokens.
 *
 * Enabled purely by env — when OKTA_ISSUER / OKTA_CLIENT_ID / OKTA_CLIENT_SECRET
 * are unset the whole flow is dormant and the login button stays hidden.
 */

const ISSUER = process.env.OKTA_ISSUER?.replace(/\/$/, "") ?? "";
const CLIENT_ID = process.env.OKTA_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.OKTA_CLIENT_SECRET ?? "";

export function oktaConfigured(): boolean {
  return Boolean(ISSUER && CLIENT_ID && CLIENT_SECRET);
}

export function oktaClientId(): string { return CLIENT_ID; }

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

let cachedDiscovery: Discovery | null = null;

/**
 * Resolve Okta's endpoints from the issuer's discovery document. Works for both
 * org auth servers (issuer = https://org.okta.com) and custom ones
 * (issuer = https://org.okta.com/oauth2/default), which have different paths.
 */
export async function getDiscovery(): Promise<Discovery> {
  if (cachedDiscovery) return cachedDiscovery;
  const res = await fetch(`${ISSUER}/.well-known/openid-configuration`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Okta discovery failed (${res.status})`);
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) {
    throw new Error("Okta discovery document is missing required endpoints");
  }
  cachedDiscovery = doc;
  return doc;
}

export async function buildAuthorizeUrl(opts: { state: string; nonce: string; redirectUri: string }): Promise<string> {
  const { authorization_endpoint } = await getDiscovery();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: opts.redirectUri,
    state: opts.state,
    nonce: opts.nonce,
  });
  return `${authorization_endpoint}?${params.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ access_token: string }> {
  const { token_endpoint } = await getDiscovery();
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Okta token exchange failed (${res.status})`);
  return res.json();
}

export interface OktaUserInfo {
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
}

export async function fetchUserInfo(accessToken: string): Promise<OktaUserInfo> {
  const { userinfo_endpoint } = await getDiscovery();
  const res = await fetch(userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Okta userinfo failed (${res.status})`);
  return res.json();
}
