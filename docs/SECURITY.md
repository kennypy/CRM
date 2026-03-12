# NexCRM Security Architecture

> Version 2.1 | Updated 2026-03-12

---

## Table of Contents

1. [Authentication Flows](#1-authentication-flows)
2. [Role-Based Access Control (RBAC)](#2-role-based-access-control-rbac)
3. [Service-to-Service Authentication](#3-service-to-service-authentication)
4. [Encryption and Secret Management](#4-encryption-and-secret-management)
5. [Multi-Tenant Isolation](#5-multi-tenant-isolation)
6. [Audit Logging](#6-audit-logging)
7. [Rate Limiting](#7-rate-limiting)
8. [Input Validation and Injection Prevention](#8-input-validation-and-injection-prevention)
9. [Webhook Security](#9-webhook-security)
10. [Data Privacy and Compliance (GDPR/CCPA)](#10-data-privacy-and-compliance-gdprccpa)
11. [Known Gaps and Security Roadmap](#11-known-gaps-and-security-roadmap)

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
   - Stores state -> tenantId mapping in Redis (SET ... EX 600, 10-min TTL)
   - Redirects to Google consent screen

2. GET /auth/oauth/google/callback
   - Validates the state parameter against Redis and atomically deletes it
   - Exchanges the authorization code for Google tokens
   - Encrypts OAuth tokens with AES-256-GCM before DB storage
   - Upserts the user in the users table (creates with 'rep' role if new)
   - Issues a NexCRM JWT access token + refresh token
   - Creates a one-time session entry in Redis (32-byte random ID, SET ... EX 15)
   - Redirects to {APP_URL}/api/auth/oauth-callback?session=<id>

3. GET /auth/oauth-session/:id  (internal, server-to-server only)
   - Called by the Next.js Route Handler, not the browser
   - Atomically reads and deletes the session via Redis pipeline (GET + DEL)
   - Entry expires after 15 seconds if not consumed
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
   - Per-email rate limit: max 3 requests per email per hour (Redis counter
     keyed by SHA-256 hash of the email to avoid storing PII)
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

Both services perform strict checks before accepting traffic:

- **JWT_SECRET:** Must be set. In production, must be at least 32 characters and must
  not contain `"dev"` or `"change"` substrings.
- **OAUTH_ENCRYPTION_KEY:** Must be a 64-character hex string (32 bytes). In
  production the service exits immediately if this is missing or malformed. In
  development a warning is logged.
- **REDIS_URL:** Must be set in production. The shared Redis client modules in both
  the API gateway and auth service throw a fatal error on startup if `REDIS_URL` is
  unset in production, preventing services from running with hardcoded dev credentials.
  In development, falls back to the local Docker Compose Redis instance.

Source: `services/auth/src/index.ts`, `services/api-gateway/src/lib/redis.ts`,
`services/auth/src/lib/redis.ts`.

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

### 2.4 API Key Scope Enforcement

API keys carry scopes (`crm:read`, `crm:write`, `ai:read`, `ai:write`) that are checked
by scope middleware at the gateway layer. JWT-authenticated users bypass scope checks
entirely — scopes only apply to API key callers.

**Scope middleware (`requireScopes`):**
- If `request.user.role !== "api_key"`, returns immediately (no-op for JWT users)
- Checks that all required scopes are present in `request.user.scopes`
- Returns 403 `INSUFFICIENT_SCOPE` if any scope is missing

**Route classification:**
- CRM entity routes (contacts, companies, deals, etc.): `requireCrmRead` on GET,
  `requireCrmWrite` on POST/PATCH/DELETE
- AI routes (NL, review queue, enrichment, etc.): `requireAiRead` on GET,
  `requireAiWrite` on POST
- Admin/sensitive routes (users, tenant, billing, permissions, compliance, dedup,
  api-keys, admin-reports): `denyApiKeys` — rejects any API key with 403

**`denyApiKeys` guard:** Completely blocks API key access. Used for routes that should
only be accessible to interactive (JWT-authenticated) users: user management, tenant
settings, billing, permissions, compliance, deduplication, and admin reports.

**RBAC for API keys:** API keys are assigned rank 1 in the role hierarchy (equivalent
to `rep`), which is acceptable because fine-grained access is enforced by scope
middleware on every route.

Source: `services/api-gateway/src/middleware/scope.ts`,
`services/api-gateway/src/middleware/rbac.ts`.

### 2.5 Admin Service Protection

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

## 3. Service-to-Service Authentication

### 3.1 Internal Service Token

All inter-service communication is authenticated using a shared secret
(`INTERNAL_SERVICE_SECRET`) sent via the `x-service-token` HTTP header. This prevents
any network-adjacent caller from forging gateway-injected identity headers
(`x-user-id`, `x-tenant-id`, `x-user-role`).

**Token injection:**
- The API gateway's `createProxy()` function injects the token into all proxied
  requests.
- The `internalFetch()` helper injects the token for all direct `fetch()` calls from
  the gateway to internal services (reports, bulk operations, AI review apply,
  workflow engine actions, close-date handler, scheduled reports, etc.).

**Token validation (Node.js services — graph-core, outreach, auth):**
- Fastify `onRequest` hook using `crypto.timingSafeEqual()` for constant-time
  comparison (prevents timing side-channel attacks).
- Accepts either `INTERNAL_SERVICE_SECRET` or `INTERNAL_SERVICE_SECRET_NEXT` for
  zero-downtime secret rotation.

**Token validation (Python services — ai-engine, ingestion):**
- FastAPI middleware using `hmac.compare_digest()` for constant-time comparison.
- Same dual-token rotation support.

**Public path allowlist:** The following paths are exempt from token validation:
- `/health` — all services
- `/email/unsubscribe` — outreach (public unsubscribe links)
- `/calls/webhooks/twilio/status` — outreach (Twilio status callbacks)

**Dev mode:** Token validation is skipped when `ALLOW_MISSING_SERVICE_TOKEN=true` is
explicitly set **and** no secret is configured. This prevents accidental fail-open in
staging or CI — the flag must be consciously set.

**Production startup:** All services refuse to start in production if
`INTERNAL_SERVICE_SECRET` is not set.

Source: `services/api-gateway/src/lib/internal-fetch.ts`,
`services/api-gateway/src/lib/proxy.ts`,
`services/graph-core/src/middleware/service-token.ts`,
`services/outreach/src/middleware/service-token.ts`,
`services/auth/src/middleware/service-token.ts`,
`services/ai-engine/src/middleware/service_token.py`,
`services/ingestion/src/middleware/service_token.py`.

### 3.2 Secret Rotation Procedure

To rotate `INTERNAL_SERVICE_SECRET` with zero downtime:

1. Generate a new secret: `openssl rand -hex 32`
2. Set `INTERNAL_SERVICE_SECRET_NEXT=<new_secret>` on all services and restart
3. Once all services accept the new secret, set
   `INTERNAL_SERVICE_SECRET=<new_secret>` and clear `INTERNAL_SERVICE_SECRET_NEXT`
4. Restart all services

### 3.3 Docker Compose Network Isolation

Internal services bind to `127.0.0.1` in Docker Compose, preventing direct access
from outside the host:

```yaml
auth:        ports: ["127.0.0.1:4001:4001"]
graph-core:  ports: ["127.0.0.1:4002:4002"]
outreach:    ports: ["127.0.0.1:4003:4003"]
ai-engine:   ports: ["127.0.0.1:5001:5001"]
```

Only the API gateway (port 4000) and web frontend (port 3000) are publicly exposed.

### 3.4 Kubernetes/Cloud Deployment

For production deployments beyond Docker Compose:
- Use NetworkPolicy to restrict inter-pod traffic so only the gateway can reach
  internal services
- Consider a service mesh with mTLS (e.g., Istio, Linkerd) as defense-in-depth
  beyond the service token

---

## 4. Encryption and Secret Management

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
[Known Gaps](#10-known-gaps-and-security-roadmap).

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

Rate limiting is enforced at three levels: the auth service, the API gateway, and
per-endpoint custom limits. All rate limit counters are stored in Redis, ensuring
they are shared across all service replicas in a multi-instance deployment.

### 6.1 Auth Service

| Scope              | Limit           | Window    | Key              | Store |
|--------------------|-----------------|-----------|------------------|-------|
| All auth endpoints | 20 requests     | 1 minute  | Client IP        | Redis |
| OAuth initiation   | 20 requests     | 10 minutes| Client IP        | Redis |
| Password reset     | 3 per email     | 1 hour    | SHA-256(email)   | Redis |

The auth service uses `@fastify/rate-limit` with a Redis backend. The key generator
uses `req.ip` with proxy trust enabled. The per-email password reset limit uses
SHA-256 hashed email addresses as Redis keys to avoid storing PII.

Source: `services/auth/src/index.ts`, `services/auth/src/routes/auth.routes.ts`.

### 6.2 API Gateway

| Scope              | Limit           | Window    | Key              | Store |
|--------------------|-----------------|-----------|------------------|-------|
| Global default     | 200 requests    | 1 minute  | JWT sub or IP    | Redis |
| AI NL endpoint     | 20 requests     | 1 minute  | Client IP        | Redis |

The gateway uses `@fastify/rate-limit` with a Redis backend. The key generator
uses the authenticated user's JWT `sub` claim when available, falling back to
client IP for unauthenticated requests. Each unidentifiable request gets its own
unique key to prevent a single bad actor from exhausting a shared bucket.

The gateway trusts exactly one hop of reverse proxy for accurate client IP resolution.

Source: `services/api-gateway/src/index.ts`.

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

## 9. Data Privacy and Compliance (GDPR/CCPA)

### 9.1 Data Subject Request (DSR) Automation

NexCRM provides automated processing of data subject requests as required by GDPR
(Articles 15-21) and CCPA. DSRs are submitted via `POST /api/v1/compliance/dsr` and
processed asynchronously by a BullMQ worker.

**Supported request types:**

| Type | Regulation | Automation |
|------|-----------|-----------|
| `access` | GDPR Art. 15 | Gathers all data for the subject (contacts, activities, deals, emails, audit log) and packages as downloadable JSON |
| `erasure` | GDPR Art. 17 | Anonymizes PII (`[REDACTED]`), deletes associated records within a DB transaction, writes audit log |
| `portability` | GDPR Art. 20 | Same as access, machine-readable JSON format |
| `rectification` | GDPR Art. 16 | Flags records for manual review |
| `restriction` | GDPR Art. 18 | Flags records to prevent further processing |
| `do_not_sell` | CCPA | Sets `do_not_sell` flag on contact, cancels active outreach sequences |
| `ccpa_access` | CCPA | Same as GDPR access |
| `ccpa_delete` | CCPA | Same as GDPR erasure |

**Processing:** Each DSR is created as a database record with status tracking, then
enqueued as a BullMQ job with 3 retry attempts and exponential backoff. The worker
updates status through `pending` → `in_progress` → `completed`/`failed`.

**Erasure safety:** Erasure requests run inside a PostgreSQL transaction. Contact PII
fields are set to `[REDACTED]` (preserving the UUID for referential integrity), email
content is redacted, and associated activities are deleted. An audit log entry records
the erasure for compliance proof.

Source: `services/api-gateway/src/workers/dsr-processor.ts`,
`services/api-gateway/src/routes/compliance.ts`.

### 9.2 CCPA Compliance

CCPA-specific endpoints provide:

- **`GET /compliance/ccpa/status`** — Returns opt-out contact count, pending CCPA
  requests, supported rights, and data categories collected.
- **`POST /compliance/ccpa/opt-out`** — Marks a contact as "do not sell" and cancels
  active outreach sequences. Processed by the DSR worker.
- **`GET /compliance/ccpa/disclosures`** — Returns data categories collected, third-party
  sharing recipients, and retention periods (per CCPA § 1798.130).

**Database schema:** The `contacts` table includes `do_not_sell BOOLEAN DEFAULT FALSE`
and `ccpa_opt_out_at TIMESTAMPTZ` columns.

Source: `infra/db/migrations/029_ccpa.sql`,
`services/api-gateway/src/routes/compliance.ts`.

### 9.3 Data Retention

Retention policies are configurable per entity type per tenant via
`POST /api/v1/compliance/retention`. Default retention periods:

| Entity Type | Default Retention | Auto-Archive | Auto-Delete |
|-------------|------------------|--------------|-------------|
| Contacts | 730 days (2 years) | Yes | No |
| Companies | 730 days | Yes | No |
| Deals | 1095 days (3 years) | Yes | No |
| Activities | 365 days (1 year) | Yes | No |
| Audit log | 2555 days (7 years) | No | No |
| Call recordings | 365 days | Yes | Yes |
| Email content | 730 days | Yes | No |

Source: `services/api-gateway/src/routes/compliance.ts`.

---

## 10. Known Gaps and Security Roadmap

### 10.1 Current Known Gaps

| Gap | Risk | Severity | Mitigation / Notes |
|-----|------|----------|-------------------|
| **No PostgreSQL Row-Level Security** | Tenant isolation relies solely on application-level `WHERE tenant_id = $1` clauses. A bug in a query could leak cross-tenant data. | HIGH | All queries are parameterized and tested, but RLS would provide defense-in-depth. Planned for Phase 3. |
| **No SAML/SCIM** | Enterprise SSO and automated user provisioning are not yet available. | MEDIUM | Planned for Phase 3 (enterprise tier). |
| **No distributed locking for plan quota enforcement** | Sequence enrollment plan limits (step/contact quotas) have no distributed lock, allowing a race condition on concurrent enrollments. | LOW | Unlikely in practice but could allow minor overages. |

#### Resolved Gaps (Phase 2.1)

| Gap | Resolution |
|-----|-----------|
| **No service-to-service auth** | Added `INTERNAL_SERVICE_SECRET` header validation on all internal services using timing-safe comparison. All gateway-to-service calls inject the token via `internalFetch()` and `createProxy()`. |
| **Internal services publicly reachable** | Docker Compose now binds internal services to `127.0.0.1` only. |
| **API key scopes not enforced** | Added `requireScopes()` middleware on all gateway routes. `denyApiKeys` blocks API keys from admin/compliance/billing routes. |
| **Rate-limit shared "unknown" bucket** | Auth and outreach services now use `crypto.randomUUID()` fallback instead of shared `"unknown"` key. |
| **trustProxy defaults to enabled** | Changed to opt-in: `TRUST_PROXY=true` required to trust X-Forwarded-For. |
| **Mobile endpoint map references non-existent paths** | Fixed calling endpoints to use `/api/v1/outreach/calls`, audit log to `/api/v1/compliance/audit-log`. Admin routes proxied via gateway `/api/admin/*`. |

#### Resolved Gaps (Phase 2)

| Gap | Resolution |
|-----|-----------|
| **In-memory OAuth state store** | Replaced with Redis-backed stores using `SET ... EX NX` with automatic TTL expiration. Supports multi-replica deployments and survives service restarts. |
| **Password reset lacks dedicated rate limiting** | Added per-email rate limiting (3 per email per hour) using SHA-256 hashed email keys in Redis. Silently skips email send when exceeded (no information leakage). |
| **Token refresh rate limiter is per-process** | Connected `@fastify/rate-limit` to Redis in both the auth service and API gateway. Rate limit counters are now global across all replicas. |
| **GraphQL introspection enabled** | Disabled in production via `NoSchemaIntrospectionCustomRule` from `graphql-js`. Introspection remains enabled in development. |
| **Hardcoded Redis dev passwords** | All workers now use a shared Redis client module that enforces `REDIS_URL` in production (fatal error on startup if missing). Dev fallbacks only apply when `NODE_ENV !== "production"`. |

### 10.2 Security Roadmap

#### Phase 2 (Months 7-12)

- [x] Replace in-memory OAuth state and session stores with Redis (`SET key value EX ttl NX`)
- [x] Connect `@fastify/rate-limit` to a shared Redis store for global rate limiting
- [x] Add per-email rate limiting on password reset (e.g., 3 per email per hour)
- [x] Disable GraphQL introspection in production
- [x] Require `REDIS_URL` env var in production for all worker services
- [x] GDPR DSR automation (data subject access requests)
- [x] CCPA compliance tooling

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
| `REDIS_URL`             | Yes†     | Redis connection URL             | Redis for rate limiting, OAuth state, workers |
| `GOOGLE_CLIENT_ID`      | Yes*     | Google OAuth client ID           | Google OAuth PKCE flow                     |
| `GOOGLE_CLIENT_SECRET`  | Yes*     | Google OAuth client secret       | Google OAuth token exchange                |
| `STRIPE_WEBHOOK_SECRET` | Yes*     | Stripe signing secret            | Inbound webhook signature verification     |
| `TRUST_PROXY`           | No       | `"true"` / `"false"`             | Whether to trust X-Forwarded-For (default: false) |
| `INTERNAL_SERVICE_SECRET` | Yes†  | 32+ hex chars                    | Service-to-service authentication token |
| `INTERNAL_SERVICE_SECRET_NEXT` | No | 32+ hex chars                | Secondary token for zero-downtime rotation |
| `ALLOW_MISSING_SERVICE_TOKEN` | No | `"true"`                      | Dev only — skip token validation when no secret configured |

\* Required for the respective feature to function. The auth service enforces
`JWT_SECRET` and `OAUTH_ENCRYPTION_KEY` at startup.

† Required in production. In development, falls back to the local Docker Compose Redis
instance. Both the API gateway and auth service refuse to start in production without it.

## Appendix B: CORS Configuration

The auth service accepts requests only from:
- `APP_URL` (default: `http://localhost:3000`) -- the Next.js frontend
- `API_GATEWAY_URL` (default: `http://localhost:4000`) -- the API gateway

Both origins require `credentials: true` for cookie transmission.

The auth service is designed to be **internal-only** -- it should never be directly
exposed to the public internet. All client traffic routes through the API gateway.

Source: `services/auth/src/index.ts`, lines 56-62.
