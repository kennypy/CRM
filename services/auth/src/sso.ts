/**
 * SSO shared logic — JIT provisioning (used by both the Okta OIDC flow and
 * SAML) and per-tenant SAML service-provider handling.
 *
 * SAML config lives in tenants.settings (flat keys, editable via the admin
 * settings PATCH):
 *   samlEnabled     boolean — master switch
 *   samlEntryPoint  string  — IdP SSO URL (HTTP-Redirect binding)
 *   samlIdpIssuer   string  — IdP entity ID (informational; response audience
 *                             is validated against our SP issuer)
 *   samlCert        string  — IdP X.509 signing certificate (PEM or bare base64)
 *
 * The web app hosts the browser-facing endpoints (/api/auth/sso/saml/*) and
 * calls the internal routes here; this service holds the IdP config, validates
 * response signatures, and mints app tokens.
 */

import type { FastifyInstance } from "fastify";
import { SAML } from "@node-saml/node-saml";
import { pool } from "./db";
import { buildJWTPayload, createRefreshToken } from "./tokens";
import { findTenantBySlug, scopesForRole, toPublicUser, toPublicTenant, touchLastLogin, type DBUser } from "./users";

// ── JIT provisioning (shared by OIDC + SAML) ────────────────────────────────

export interface SsoIdentity {
  email:      string;
  tenantSlug?: string | null;
  firstName?: string | null;
  lastName?:  string | null;
  avatarUrl?: string | null;
}

export type SsoProvisionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

/**
 * Resolve the tenant (slug first, then email-domain mapping), create or
 * refresh the user (default role 'rep', password stays NULL), and mint the
 * app's own access + refresh tokens exactly like password login.
 */
export async function provisionSsoUser(server: FastifyInstance, identity: SsoIdentity): Promise<SsoProvisionResult> {
  const emailLc = identity.email.toLowerCase();

  let tenant: { id: string; name: string; slug: string; plan?: string } | null = null;
  if (identity.tenantSlug) {
    tenant = await findTenantBySlug(identity.tenantSlug);
  }
  if (!tenant) {
    const domain = emailLc.split("@")[1] ?? "";
    if (domain) {
      const { rows } = await pool.query(
        `SELECT * FROM tenants WHERE lower(domain) = $1 AND deleted_at IS NULL LIMIT 1`,
        [domain]
      );
      tenant = rows[0] ?? null;
    }
  }
  if (!tenant) {
    return {
      ok: false, status: 404, code: "TENANT_NOT_FOUND",
      message: "No workspace matches this account. Check the workspace name or ask an admin to map your email domain.",
    };
  }

  const fn = (identity.firstName && identity.firstName.trim()) || emailLc.split("@")[0];
  const ln = (identity.lastName && identity.lastName.trim()) || "";
  const { rows } = await pool.query<DBUser & { deleted_at: string | null }>(
    `INSERT INTO users (tenant_id, email, first_name, last_name, avatar_url, role)
     VALUES ($1, $2, $3, $4, $5, 'rep')
     ON CONFLICT (tenant_id, email) DO UPDATE SET
       first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
       last_name  = COALESCE(NULLIF(EXCLUDED.last_name, ''),  users.last_name),
       avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
       updated_at = NOW()
     RETURNING *`,
    [tenant.id, emailLc, fn, ln, identity.avatarUrl ?? null]
  );
  const dbUser = rows[0];

  // A previously deactivated account must not be silently reactivated by SSO.
  if (dbUser.deleted_at) {
    return {
      ok: false, status: 403, code: "ACCOUNT_DISABLED",
      message: "This account has been disabled. Contact your administrator.",
    };
  }

  const scopes = scopesForRole(dbUser.role);
  const accessToken = server.jwt.sign(
    buildJWTPayload({ id: dbUser.id, tenantId: dbUser.tenant_id, email: dbUser.email, role: dbUser.role, scopes })
  );
  const refreshToken = await createRefreshToken(dbUser.id);
  await touchLastLogin(dbUser.id);

  return {
    ok: true,
    data: {
      accessToken,
      refreshToken,
      user: toPublicUser(dbUser),
      tenant: toPublicTenant(tenant),
    },
  };
}

// ── Per-tenant SAML service provider ────────────────────────────────────────

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
/** Our SP entity ID — what IdPs must set as the audience/entity of the app. */
export const SAML_SP_ISSUER = process.env.SAML_SP_ISSUER ?? `${APP_URL}/api/auth/sso/saml/metadata`;
/** Assertion Consumer Service URL — the web route that receives the POST. */
export const SAML_CALLBACK_URL = `${APP_URL}/api/auth/sso/saml/callback`;

interface TenantSamlConfig {
  entryPoint: string;
  idpIssuer:  string;
  cert:       string;
}

/** Returns the tenant's SAML config, or null when SAML is not enabled. */
export function tenantSamlConfig(settings: Record<string, unknown> | null | undefined): TenantSamlConfig | null {
  const s = settings ?? {};
  if (s.samlEnabled !== true) return null;
  const entryPoint = typeof s.samlEntryPoint === "string" ? s.samlEntryPoint : "";
  const idpIssuer  = typeof s.samlIdpIssuer  === "string" ? s.samlIdpIssuer  : "";
  const cert       = typeof s.samlCert       === "string" ? s.samlCert       : "";
  if (!entryPoint || !cert) return null;
  return { entryPoint, idpIssuer, cert };
}

export function buildSamlInstance(config: TenantSamlConfig): SAML {
  return new SAML({
    callbackUrl: SAML_CALLBACK_URL,
    entryPoint:  config.entryPoint,
    issuer:      SAML_SP_ISSUER,
    idpCert:     config.cert,
    audience:    SAML_SP_ISSUER,
    // Require a signed assertion; tolerate IdPs that don't also sign the
    // outer response envelope (common default for Azure AD / ADFS).
    wantAssertionsSigned:   true,
    wantAuthnResponseSigned: false,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    acceptedClockSkewMs: 5000,
  });
}

// Common attribute names IdPs use for profile fields.
const EMAIL_ATTRS = [
  "email", "mail", "emailaddress",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
];
const FIRST_NAME_ATTRS = [
  "firstName", "givenName", "given_name",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
];
const LAST_NAME_ATTRS = [
  "lastName", "surname", "sn", "family_name",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
];

function pickAttr(profile: Record<string, unknown>, names: string[]): string | null {
  for (const n of names) {
    const v = profile[n];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) return v[0].trim();
  }
  return null;
}

export interface SamlIdentity {
  email:     string;
  firstName: string | null;
  lastName:  string | null;
}

/** Map a validated SAML profile to the identity fields we provision from. */
export function extractSamlIdentity(profile: Record<string, unknown>): SamlIdentity | null {
  const nameId = typeof profile.nameID === "string" ? profile.nameID : "";
  const email = (nameId.includes("@") ? nameId : null) ?? pickAttr(profile, EMAIL_ATTRS);
  if (!email || !email.includes("@")) return null;
  return {
    email,
    firstName: pickAttr(profile, FIRST_NAME_ATTRS),
    lastName:  pickAttr(profile, LAST_NAME_ATTRS),
  };
}
