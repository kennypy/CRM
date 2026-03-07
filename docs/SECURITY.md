# NexCRM Security Architecture

> Version 1.0 | Updated 2026-03-07

---

## Table of Contents

1. [Authentication Flows](#1-authentication-flows)
2. [Role-Based Access Control (RBAC)](#2-role-based-access-control-rbac)
3. [Encryption and Secret Management](#3-encryption-and-secret-management)
4. [Multi-Tenant Isolation](#4-multi-tenant-isolation)
5. [Audit Logging](#5-audit-logging)
6. [Rate Limiting](#6-rate-limiting)
7. [Input Validation and Injection Prevention](#7-input-validation-and-injection-prevention)
8. [Webhook Security](#8-webhook-security)
9. [Known Gaps and Security Roadmap](#9-known-gaps-and-security-roadmap)

---

## 1. Authentication Flows

NexCRM supports four authentication mechanisms: JWT bearer tokens, OAuth 2.0 PKCE,
API keys for server-to-server access, and a password reset flow.

### 1.1 JWT Bearer Tokens

The primary authentication mechanism uses short-lived access tokens paired with
long-lived, rotating refresh tokens.

| Token Type     | Lifetime | Storage                            | Rotation Policy                     |
|----------------|----------|------------------------------------|-------------------------------------|
| Access token   | 15 min   | Client memory / HttpOnly cookie    | Issued on login, refresh, or OAuth  |
| Refresh token  | 30 days  | HttpOnly / SameSite=Strict cookie  | Rotated on every use (one-time)     |

**Access token claims (JWT payload):**

```json
{
  "sub":      "<user-id>",
  "tenantId": "<tenant-id>",
  "email":    "user@example.com",
  "role":     "rep",
  "scopes":   ["crm:read", "crm:write", "ai:read"],
  "iat":      1709827200,
  "exp":      1709828100
}
```

Source: `packages/shared-types/src/auth.ts` (JWTPayload interface),
`services/auth/src/tokens.ts` (buildJWTPayload).

**Signing:** HMAC-SHA256 via `@fastify/jwt`. The `JWT_SECRET` environment variable
must be a cryptographically random value of at least 32 characters. The auth service
refuses to start in production if the secret appears to be a placeholder or is too
short.

Source: `services/auth/src/index.ts`, lines 27-38.

**Refresh token rotation:** When a refresh token is consumed, the server acquires a
row-level `FOR UPDATE` lock on the `refresh_tokens` row to prevent double-spend race
conditions, revokes the used token, and issues a new one. This limits the replay
window to a single request.

Source: `services/auth/src/tokens.ts`, `consumeRefreshToken()`.

**Logout:** `POST /auth/logout` revokes all refresh tokens for the authenticated user,
invalidating every active session.

### 1.2 OAuth 2.0 PKCE (Google)

Used for Google OAuth sign-in and Gmail/Calendar integration token acquisition.

**Flow:**

```
1. GET /auth/oauth/google
   - Requires an authenticated JWT (tenantId is read from the verified JWT,
     never from a query parameter, preventing CSRF tenant-swap attacks)
   - Generates a cryptographically random state parameter (16 bytes)
   - Stores state -> tenantId mapping in an in-memory Map (10-min TTL)
   - Redirects to Google consent screen

2. GET /auth/oauth/google/callback
   - Validates the state parameter against the in-memory store
   - Exchanges the authorization code for Google tokens
   - Encrypts OAuth tokens with AES-256-GCM before DB storage
   - Upserts the user in the users table (creates with 'rep' role if new)
   - Issues a NexCRM JWT access token + refresh token
   - Creates a one-time session entry (32-byte random ID, 15-second TTL)
   - Redirects to {APP_URL}/api/auth/oauth-callback?session=<id>

3. GET /auth/oauth-session/:id  (internal, server-to-server only)
   - Called by the Next.js Route Handler, not the browser
   - Returns tokens once and immediately deletes the session entry
   - Entry expires after 15 seconds
   - Next.js sets HttpOnly cookies and redirects the user to the app
```

Source: `services/auth/src/routes/oauth.routes.ts`.

**Scopes requested from Google:** `openid`, `email`, `profile`,
`gmail.readonly`, `calendar.readonly`.

### 1.3 API Keys (Server-to-Server)

API keys enable machine-to-machine integrations without user-interactive OAuth.

**Key format:** `nxc_<80 random hex characters>` (40 random bytes).

**Storage:** Only the SHA-256 hash of the key is stored in the `api_keys` table. The
raw key is returned exactly once at creation time and is never retrievable again. A
`key_prefix` (first 12 characters) is stored for UI display.

**Authentication header:** `Authorization: ApiKey nxc_<raw_key>`

**Scoping:** Each API key is assigned a subset of scopes from:
`crm:read`, `crm:write`, `ai:read`, `ai:write`. Keys default to `crm:read` only.

**Expiration:** Optional `expires_at` timestamp. Expired keys are rejected at lookup
time.

**Revocation:** `DELETE /api/v1/api-keys/:id` soft-deletes by setting `is_active = FALSE`.

**Lookup:** On each API request, the gateway hashes the raw key with SHA-256 and looks
up the hash in the `api_keys` table. The `last_used_at` timestamp is updated
asynchronously.

Source: `services/api-gateway/src/routes/api-keys.ts`,
`infra/db/migrations/013_api_keys_webhooks_password_reset.sql`.

### 1.4 Password Reset

**Flow:**

```
1. POST /auth/forgot-password  { email, tenantSlug }
   - Always returns HTTP 200 regardless of whether the user/tenant exists
     (prevents user enumeration)
   - Generates a 32-byte random token
   - Stores SHA-256 hash of the token in password_reset_tokens (1-hour TTL)
   - Sends reset email asynchronously (non-blocking)

2. POST /auth/reset-password  { token, password }
   - Hashes the submitted token with SHA-256 and looks up a valid,
     unused, non-expired row
   - Validates the new password against the same complexity rules
     as registration (12+ chars, upper, lower, digit, special)
   - Updates the user's password_hash (bcrypt, 12 rounds)
   - Marks the reset token as used (used_at = NOW())
   - Revokes ALL existing refresh tokens for the user
```

Source: `services/auth/src/routes/auth.routes.ts`, lines 242-324.

**Password complexity requirements:**

| Rule                 | Minimum |
|----------------------|---------|
| Length               | 12 characters |
| Lowercase letter     | 1 |
| Uppercase letter     | 1 |
| Digit                | 1 |
| Special character    | 1 |

### 1.5 Startup Secret Validation

The auth service performs strict checks before accepting traffic:

- **JWT_SECRET:** Must be set. In production, must be at least 32 characters and must
  not contain `"dev"` or `"change"` substrings.
- **OAUTH_ENCRYPTION_KEY:** Must be a 64-character hex string (32 bytes). In
  production the service exits immediately if this is missing or malformed. In
  development a warning is logged.

Source: `services/auth/src/index.ts`, lines 27-50.

---

## 2. Role-Based Access Control (RBAC)

### 2.1 Role Hierarchy

Roles are ranked numerically. A user can perform any action that requires their role
level or below.

```
super_admin (4)  >  admin (3)  >  manager (2)  >  rep (1)  >  read_only (0)
```

Source: `services/api-gateway/src/middleware/rbac.ts`.

### 2.2 Scope Assignments per Role

Scopes are embedded in the JWT at login time and checked by the API gateway.

| Scope                 | read_only | rep | manager | admin | super_admin |
|-----------------------|-----------|-----|---------|-------|-------------|
| `crm:read`            | Y         | Y   | Y       | Y     | Y           |
| `crm:write`           | -         | Y   | Y       | Y     | Y           |
| `ai:read`             | -         | Y   | Y       | Y     | Y           |
| `ai:write`            | -         | -   | -       | Y     | Y           |
| `admin:read`          | -         | -   | Y       | Y     | Y           |
| `admin:write`         | -         | -   | -       | Y     | Y           |
| `integrations:read`   | -         | -   | -       | -     | Y           |
| `integrations:write`  | -         | -   | -       | -     | Y           |

Source: `packages/shared-types/src/auth.ts`, `ROLE_SCOPES` constant.

### 2.3 RBAC Enforcement Matrix

The API gateway enforces minimum role requirements per endpoint via `preHandler`
middleware. The table below documents the actual enforcement as found in the codebase.

| Resource                    | Read (GET)  | Create (POST) | Update (PATCH) | Delete       |
|-----------------------------|-------------|---------------|----------------|--------------|
| Contacts                    | any auth'd  | rep+          | rep+           | manager+     |
| Companies                   | any auth'd  | rep+          | rep+           | manager+     |
| Deals                       | any auth'd  | rep+          | rep+           | manager+     |
| Activities                  | any auth'd  | rep+          | rep+           | manager+     |
| Tasks                       | any auth'd  | rep+          | rep+           | rep+         |
| Users                       | admin+      | admin+        | admin+         | admin+       |
| User invite                 | -           | admin+        | -              | -            |
| Products                    | any auth'd  | admin+        | admin+         | admin+       |
| Quotes                      | any auth'd  | any auth'd    | any auth'd     | any auth'd   |
| Workflows                   | rep+        | rep+          | rep+           | manager+     |
| Sequences                   | any auth'd  | manager+      | manager+       | manager+     |
| Sequence enrollment         | -           | rep+          | -              | -            |
| Email send                  | -           | rep+          | -              | -            |
| Phone calls                 | any auth'd  | rep+          | rep+           | -            |
| Custom objects (definitions)| rep+        | admin+        | admin+         | admin+       |
| Custom objects (records)    | rep+        | rep+          | rep+           | rep+         |
| Custom fields               | rep+        | admin+        | admin+         | admin+       |
| Bulk update                 | -           | rep+          | -              | -            |
| Bulk delete                 | -           | manager+      | -              | -            |
| Import                      | -           | rep+          | -              | -            |
| Permissions (record-level)  | rep+        | admin+        | -              | admin+       |
| Permissions (field-level)   | rep+        | admin+        | -              | -            |
| Permission defaults         | rep+        | admin+        | -              | -            |
| Dialer config               | any auth'd  | admin+        | -              | admin+       |
| Slack connect/disconnect    | -           | admin+        | -              | admin+       |
| Slack status/users          | rep+        | -             | -              | -            |
| AI NL query                 | -           | rep+          | -              | -            |
| AI review queue             | any auth'd  | rep+          | -              | -            |
| AI enrichment               | -           | rep+          | -              | -            |
| Admin reports               | admin+      | -             | -              | -            |
| Admin routes (auth service) | super_admin | super_admin   | super_admin    | -            |

Source: `services/api-gateway/src/routes/*.ts`, `services/auth/src/routes/admin.routes.ts`.

### 2.4 Admin Service Protection

All routes under `/admin/*` in the auth service require both a valid JWT **and** the
`super_admin` role. This is enforced via a global `preHandler` hook that runs
`jwtVerify()` then checks `request.user.role === "super_admin"`.

Admin capabilities include: tenant CRUD, feature toggling, tenant settings, user
listing, sub-workspace management, workspace merging, and platform-wide statistics.

Source: `services/auth/src/routes/admin.routes.ts`, lines 22-44.

### 2.5 Field-Level and Record-Level Permissions

Beyond RBAC, NexCRM supports granular permission controls stored in the database:

- **Field-level:** Per-role, per-entity-type, per-field access levels: `hidden`,
  `read_only`, or `read_write`. Stored in `field_permissions` table.
- **Record-level:** ACL entries granting `can_read`, `can_write`, `can_delete` to a
  specific user, role, or team for a specific record. Stored in `record_permissions`.
- **Defaults:** Per-entity-type defaults for owner/team/org access. Stored in
  `record_permission_defaults`.

Source: `infra/db/migrations/015_permissions.sql`,
`services/api-gateway/src/routes/permissions.ts`.

---

## 3. Encryption and Secret Management

### 3.1 Passwords: bcrypt (12 rounds)

All user passwords are hashed with bcrypt using a cost factor of 12 before storage.
The `password_hash` column is `NULL` for OAuth-only users (no password set).

**Timing-safe comparison:** On login, if the user is not found, the server still runs
bcrypt against a dummy hash to prevent user enumeration via response-time analysis.

Source: `services/auth/src/users.ts`, `BCRYPT_ROUNDS = 12`, `verifyPassword()`.

### 3.2 OAuth Tokens: AES-256-GCM

Third-party OAuth tokens (Google, Microsoft, Slack, Zoom) are encrypted at the
application layer before being written to the `oauth_tokens` table.

**Algorithm:** AES-256-GCM with a 12-byte random IV per encryption.

**Key:** 32-byte key provided via the `OAUTH_ENCRYPTION_KEY` environment variable
(64 hex characters).

**Storage format:** `base64(iv):base64(authTag):base64(ciphertext)`

**Implementation:** Both the auth service (`services/auth/src/routes/oauth.routes.ts`)
and the API gateway (`services/api-gateway/src/lib/oauth-exchange.ts`) use the same
encryption scheme. Both validate the key format at startup.

Source: `services/auth/src/routes/oauth.routes.ts`, `encryptToken()` / `decryptToken()`.

### 3.3 Webhook Signing Secrets: AES-256-GCM (Encrypted at Rest)

Outbound webhook signing secrets are encrypted with the same AES-256-GCM scheme before
storage in the `outbound_webhooks.secret` column. The delivery worker decrypts the
secret at delivery time to compute the HMAC-SHA256 signature.

Source: `services/api-gateway/src/routes/outbound-webhooks.ts`,
`services/api-gateway/src/workers/webhook-delivery.ts`.

### 3.4 Refresh Tokens and Password Reset Tokens: SHA-256

- **Refresh tokens:** 64 random bytes, stored as SHA-256 hash in `refresh_tokens.token_hash`.
- **Password reset tokens:** 32 random bytes, stored as SHA-256 hash in
  `password_reset_tokens.token_hash`.
- **API keys:** 40 random bytes (prefixed with `nxc_`), stored as SHA-256 hash in
  `api_keys.key_hash`.

In all three cases the raw secret is returned to the client exactly once and is never
retrievable from the database.

### 3.5 Transport Encryption

- **TLS 1.3 minimum** in production (enforced at the load balancer / reverse proxy).
- **HSTS headers** set via `@fastify/helmet`.
- **Secure cookie flag** on HttpOnly auth cookies.

### 3.6 Secret Management Roadmap

| Current                              | Production Target                |
|--------------------------------------|----------------------------------|
| Environment variables (`.env`)       | HashiCorp Vault or cloud KMS     |
| Single OAUTH_ENCRYPTION_KEY          | Per-tenant encryption keys       |
| Server-side encryption on Postgres   | AES-256 at rest (RDS/CloudSQL)   |

---

## 4. Multi-Tenant Isolation

### 4.1 JWT-Claim-Based Tenant Scoping

Every JWT contains a `tenantId` claim. The API gateway and downstream services extract
the tenant ID exclusively from the verified JWT -- never from query parameters, request
bodies, or headers. This is the foundational isolation mechanism.

**All database queries are tenant-scoped.** For example, `findUserByEmail()` requires
both `tenant_id` and `email`. Listing endpoints filter by `WHERE tenant_id = $1`.

Source: `services/auth/src/users.ts` (all query functions accept/use tenant_id).

### 4.2 Database Schema

Every data table includes a `tenant_id UUID NOT NULL` column with a foreign key to
`tenants(id)`. Indexes are structured as `(tenant_id, ...)` for efficient tenant-scoped
queries.

**Current enforcement:** Application-level `WHERE tenant_id = $1` clauses.

**Not yet implemented:** PostgreSQL Row-Level Security (RLS) policies. See
[Known Gaps](#9-known-gaps-and-security-roadmap).

### 4.3 Sub-Workspaces (Hierarchical Tenancy)

Tenants can have child tenants via the `parent_tenant_id` column (migration 022).
Sub-workspace operations (create, list children, merge) are restricted to
`super_admin` users.

### 4.4 Workspace Merging

The merge system (`services/auth/src/merge.ts`) allows a `super_admin` to combine two
workspaces:

1. **Preview phase:** Scans for conflicts (users with matching emails, contacts with
   matching emails, companies with matching domains, sequences with matching names,
   custom objects with matching keys).
2. **Resolution phase:** Super admin chooses `keep_source`, `keep_target`, or
   `merge_fields` for each conflict.
3. **Execution phase:** Runs inside a database transaction with `FOR UPDATE` row
   locking on the merge record. Moves all data from source to target tenant, applies
   resolutions, and soft-deletes the source tenant.
4. **Rollback:** If any step fails, the entire transaction rolls back and the merge is
   marked as `failed`.

Source: `services/auth/src/merge.ts`.

---

## 5. Audit Logging

### 5.1 Audit Log Table

The `audit_log` table records all significant actions with before/after state for
compliance and forensic analysis.

```sql
audit_log (
  id            UUID,
  tenant_id     UUID NOT NULL,
  user_id       UUID,
  action        TEXT NOT NULL,       -- e.g. 'contact.updated', 'deal.deleted'
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  before_state  JSONB,
  after_state   JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

Source: `infra/db/migrations/001_core_schema.sql`, lines 194-216.

### 5.2 Partitioning Strategy

The audit log is partitioned by quarter to support efficient time-range queries and
enable partition-level archival/deletion for retention policies.

| Partition              | Range                        |
|------------------------|------------------------------|
| `audit_log_2026_q1`   | 2026-01-01 to 2026-04-01     |
| `audit_log_2026_q2`   | 2026-04-01 to 2026-07-01     |
| `audit_log_default`   | Catch-all for other dates    |

### 5.3 Indexes

- `idx_audit_log_tenant` on `(tenant_id, created_at DESC)` -- for tenant-scoped queries.
- `idx_audit_log_entity` on `(entity_type, entity_id, created_at DESC)` -- for
  entity-specific audit trails.

### 5.4 Event Stream (crm_events)

In addition to the audit log, all system events flow through the `crm_events` table,
which is partitioned by month and published to Redis Streams. This covers both
user-initiated and system-generated events (ingestion, AI extraction, webhooks).

### 5.5 Structured Application Logs

All services use Fastify's Pino logger emitting structured JSON logs. Each request is
assigned a unique `requestId` via `crypto.randomUUID()`. Auth events are logged with
structured context:

- `auth.register` -- user ID, tenant ID
- `auth.login` -- user ID, tenant ID
- `auth.login.bad_password` -- email, tenant slug (no PII beyond email)
- `auth.logout` -- user ID
- `auth.password_reset` -- user ID
- `auth.oauth.google.success` -- user ID, tenant ID
- `api_key.created` / `api_key.revoked` -- tenant ID, user ID, key ID

---

## 6. Rate Limiting

Rate limiting is enforced at two levels: the auth service and the API gateway.

### 6.1 Auth Service

| Scope              | Limit           | Window    | Key          |
|--------------------|-----------------|-----------|--------------|
| All auth endpoints | 20 requests     | 1 minute  | Client IP    |
| OAuth initiation   | 20 requests     | 10 minutes| Client IP    |

The auth service uses `@fastify/rate-limit`. The key generator uses `req.ip` with
proxy trust enabled (`trustProxy` configured via environment variable).

Source: `services/auth/src/index.ts`, lines 65-69;
`services/auth/src/routes/oauth.routes.ts`, line 116.

### 6.2 API Gateway

| Scope              | Limit           | Window    | Key          |
|--------------------|-----------------|-----------|--------------|
| Global default     | 200 requests    | 1 minute  | Client IP    |
| AI NL endpoint     | 20 requests     | 1 minute  | Client IP    |

The gateway trusts exactly one hop of reverse proxy for accurate client IP resolution.

Source: `services/api-gateway/src/index.ts`, lines 69-107.

### 6.3 Security Headers

Both services register `@fastify/helmet` which sets:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- Various other hardening headers

CSP is disabled (`contentSecurityPolicy: false`) to allow the Next.js frontend to
function correctly.

Source: `services/auth/src/index.ts`, line 52.

---

## 7. Input Validation and Injection Prevention

### 7.1 SQL Injection

All SQL queries across all services use parameterized statements (`$1`, `$2`, etc.)
via the `pg` driver. No string interpolation is used for user-supplied values.

Dynamic column names (used in bulk update operations) are sanitized with
`/^[a-z_][a-z0-9_]*$/` regex validation before inclusion in SQL strings.

### 7.2 Request Validation

All request bodies are validated using Zod schemas before processing. Examples:

- `LoginSchema` validates email format, minimum password length, tenant slug
- `RegisterSchema` enforces password complexity and slug format (`/^[a-z0-9-]+$/`)
- `CreateKeySchema` restricts scopes to the defined enum set
- Admin route schemas validate UUID formats, enum values, and string lengths

### 7.3 Information Disclosure Prevention

- Login errors use a generic message: `"Invalid email, password, or organisation"` --
  this does not reveal whether the email, password, or tenant was incorrect.
- Forgot-password always returns HTTP 200 with `"If that account exists, a reset
  email has been sent."` regardless of whether the user or tenant exists.
- Stack traces are not exposed in production responses.
- Internal service URLs are not leaked in API responses.

---

## 8. Webhook Security

### 8.1 Inbound Webhooks (Stripe, Slack, Zoom)

Inbound webhook endpoints are publicly accessible (no JWT required) but authenticate
via provider-specific signature verification:

- **Stripe:** HMAC-SHA256 signature verification using the `Stripe-Signature` header.
  The signed payload format is `${timestamp}.${rawBody}`. Includes replay attack
  tolerance via timestamp validation.
- **Slack / Zoom:** Provider-specific signature verification on their respective
  webhook paths.

Source: `services/api-gateway/src/routes/webhooks.ts`.

### 8.2 Outbound Webhooks

Tenant-defined webhook endpoints that receive CRM event notifications:

- **Signing:** Each outbound webhook delivery is signed with HMAC-SHA256 using the
  webhook's secret key. The signature is sent in the `X-NexCRM-Signature` header
  as `sha256=<hex_digest>`.
- **Secret storage:** Webhook secrets are encrypted at rest with AES-256-GCM (same
  scheme as OAuth tokens). Decrypted only at delivery time.
- **Delivery tracking:** Each delivery attempt is logged in
  `outbound_webhook_deliveries` with attempt count, response status, and error details.
- **Additional headers:** `X-NexCRM-Event` (event type) and `X-NexCRM-Attempt`
  (retry number).

Source: `services/api-gateway/src/workers/webhook-delivery.ts`,
`infra/db/migrations/013_api_keys_webhooks_password_reset.sql`.

---

## 9. Known Gaps and Security Roadmap

### 9.1 Current Known Gaps

| Gap | Risk | Severity | Mitigation / Notes |
|-----|------|----------|-------------------|
| **In-memory OAuth state store** | OAuth state and one-time session tokens are stored in a `Map` in the auth service process. State is lost on restart and not shared across replicas. | HIGH | Deploy as a single replica until Redis-backed store is implemented. Code contains `TODO(production)` comments. |
| **No PostgreSQL Row-Level Security** | Tenant isolation relies solely on application-level `WHERE tenant_id = $1` clauses. A bug in a query could leak cross-tenant data. | HIGH | All queries are parameterized and tested, but RLS would provide defense-in-depth. |
| **No SAML/SCIM** | Enterprise SSO and automated user provisioning are not yet available. | MEDIUM | Planned for Phase 3 (enterprise tier). |
| **Password reset lacks dedicated rate limiting** | The `/auth/forgot-password` endpoint shares the global 20 req/min limit but has no per-email throttle. | MEDIUM | An attacker could trigger 20 reset emails per minute per IP. |
| **Token refresh rate limiter is per-process** | Rate limiting uses in-process state (`@fastify/rate-limit` default store), not Redis. In multi-replica deployments, limits are per-pod rather than global. | MEDIUM | Connect `@fastify/rate-limit` to Redis store. |
| **GraphQL introspection enabled** | Schema introspection is not disabled in production, exposing the full API schema. | LOW | Disable via Mercurius `graphiql: false` and `schema` introspection settings in production. |
| **No distributed locking for plan quota enforcement** | Sequence enrollment plan limits (step/contact quotas) have no distributed lock, allowing a race condition on concurrent enrollments. | LOW | Unlikely in practice but could allow minor overages. |
| **Hardcoded Redis dev passwords** | Eight ingestion worker files contain fallback Redis connection strings with development passwords. | LOW | Require `REDIS_URL` env var in production; fail-fast if missing. |

### 9.2 Security Roadmap

#### Phase 2 (Months 7-12)

- [ ] Replace in-memory OAuth state and session stores with Redis (`SET key value EX ttl NX`)
- [ ] Connect `@fastify/rate-limit` to a shared Redis store for global rate limiting
- [ ] Add per-email rate limiting on password reset (e.g., 3 per email per hour)
- [ ] Disable GraphQL introspection in production
- [ ] Require `REDIS_URL` env var in production for all worker services
- [ ] GDPR DSR automation (data subject access requests)
- [ ] CCPA compliance tooling

#### Phase 3 (Months 13-18)

- [ ] SAML 2.0 SSO integration
- [ ] SCIM provisioning for automated user lifecycle
- [ ] PostgreSQL Row-Level Security (RLS) policies for defense-in-depth tenant isolation
- [ ] Per-tenant encryption keys for enterprise customers
- [ ] Multi-region data residency (region-pinned Postgres instances)
- [ ] Custom roles and permissions builder (beyond the fixed 5-role hierarchy)
- [ ] SOC 2 Type II audit completion
- [ ] HIPAA readiness module (optional)
- [ ] Audit log export for SIEM integration
- [ ] Legal hold and data retention policies

---

## Appendix A: Environment Variables (Security-Critical)

| Variable                | Required | Format                           | Purpose                                    |
|-------------------------|----------|----------------------------------|--------------------------------------------|
| `JWT_SECRET`            | Yes      | 32+ char random string           | JWT signing key                            |
| `OAUTH_ENCRYPTION_KEY`  | Yes*     | 64-char hex (32 bytes)           | AES-256-GCM key for OAuth token encryption |
| `GOOGLE_CLIENT_ID`      | Yes*     | Google OAuth client ID           | Google OAuth PKCE flow                     |
| `GOOGLE_CLIENT_SECRET`  | Yes*     | Google OAuth client secret       | Google OAuth token exchange                |
| `STRIPE_WEBHOOK_SECRET` | Yes*     | Stripe signing secret            | Inbound webhook signature verification     |
| `TRUST_PROXY`           | No       | `"true"` / `"false"`             | Whether to trust X-Forwarded-For (default: true) |

\* Required for the respective feature to function. The auth service enforces
`JWT_SECRET` and `OAUTH_ENCRYPTION_KEY` at startup.

## Appendix B: CORS Configuration

The auth service accepts requests only from:
- `APP_URL` (default: `http://localhost:3000`) -- the Next.js frontend
- `API_GATEWAY_URL` (default: `http://localhost:4000`) -- the API gateway

Both origins require `credentials: true` for cookie transmission.

The auth service is designed to be **internal-only** -- it should never be directly
exposed to the public internet. All client traffic routes through the API gateway.

Source: `services/auth/src/index.ts`, lines 56-62.
