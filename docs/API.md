# NexCRM API Reference

## Overview

NexCRM exposes a RESTful API through an **API Gateway** (port 4000) that proxies requests to four backend microservices:

| Service | Internal Port | Responsibility |
|---------|--------------|----------------|
| API Gateway | 4000 | Routing, auth verification, RBAC |
| Auth Service | 4001 | Authentication, OAuth, tenant admin |
| Graph-Core | 4002 | Contacts, companies, deals, activities, tasks, graph queries |
| Outreach | 4003 | Email, sequences, calls, dialers |
| AI Engine | 5001 | NL queries, enrichment, forecasting |

**Base URL**: All endpoints are accessed via the gateway at `/api/v1/...`

---

## Authentication

### JWT Bearer Token

Most endpoints require a JWT in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

The JWT contains `tenantId`, `userId`, and `role` claims. All data is tenant-scoped.

### API Keys

Server-to-server integrations can use API keys:

```
Authorization: ApiKey nxc_<raw_key>
```

API key secrets are SHA-256 hashed in storage. Keys carry scopes: `crm:read`, `crm:write`, `ai:read`, `ai:write`.

**Scope enforcement:** API keys are checked against required scopes on every route:
- CRM entity routes require `crm:read` (GET) or `crm:read` + `crm:write` (POST/PATCH/DELETE)
- AI routes require `ai:read` (GET) or `ai:read` + `ai:write` (POST)
- Admin, compliance, billing, permissions, dedup, and api-keys routes are **blocked** for API keys entirely (JWT only)

### RBAC Roles (Hierarchical)

| Role | Level | Description |
|------|-------|-------------|
| `super_admin` | Highest | Platform-wide administration |
| `admin` | High | Workspace administration |
| `manager` | Medium | Team management |
| `rep` | Standard | Sales representative |
| `read_only` | Lowest | View-only access |

Higher roles inherit all permissions of lower roles.

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/v1/ai/nl` | 20 requests | Per user per minute |
| `GET /auth/oauth/google` | 20 requests | Per IP per 10 minutes |

---

## Webhook Event Types

Outbound webhooks fire for the following events:

| Event | Description |
|-------|-------------|
| `contact.created` | New contact created |
| `contact.updated` | Contact record updated |
| `contact.deleted` | Contact deleted |
| `company.created` | New company created |
| `company.updated` | Company record updated |
| `company.deleted` | Company deleted |
| `deal.created` | New deal created |
| `deal.updated` | Deal record updated |
| `deal.deleted` | Deal deleted |
| `deal.stage_changed` | Deal moved to a different pipeline stage |
| `activity.created` | New activity logged |
| `sequence.enrollment.completed` | Contact completed all sequence steps |

---

## Endpoints by Domain

### Auth

All auth routes are proxied from the gateway to the Auth Service.

#### `POST /auth/register`

Create a new workspace and admin user.

- **Auth**: None (public)
- **Request Body**:
  ```json
  {
    "email": "string",
    "password": "string",
    "firstName": "string",
    "lastName": "string",
    "workspaceName": "string"
  }
  ```
- **Response** (`201`):
  ```json
  {
    "success": true,
    "data": {
      "user": { "id", "email", "firstName", "lastName", "role" },
      "tenant": { "id", "name" },
      "accessToken": "string",
      "refreshToken": "string"
    }
  }
  ```

#### `POST /auth/login`

Authenticate and receive tokens.

- **Auth**: None (public)
- **Request Body**:
  ```json
  {
    "email": "string",
    "password": "string"
  }
  ```
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": {
      "user": { "id", "email", "firstName", "lastName", "role", "tenantId" },
      "accessToken": "string",
      "refreshToken": "string"
    }
  }
  ```

#### `POST /auth/refresh`

Refresh an expired access token.

- **Auth**: None (public)
- **Request Body**:
  ```json
  { "refreshToken": "string" }
  ```
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": { "accessToken": "string", "refreshToken": "string" }
  }
  ```

#### `POST /auth/logout`

Invalidate the refresh token.

- **Auth**: None (public)
- **Request Body**:
  ```json
  { "refreshToken": "string" }
  ```
- **Response** (`200`):
  ```json
  { "success": true }
  ```

#### `POST /auth/forgot-password`

Send a password reset email.

- **Auth**: None (public)
- **Request Body**:
  ```json
  { "email": "string" }
  ```
- **Response** (`200`):
  ```json
  { "success": true, "message": "If an account exists, a reset email has been sent." }
  ```

#### `POST /auth/reset-password`

Reset password using the emailed token.

- **Auth**: None (public)
- **Request Body**:
  ```json
  { "token": "string", "password": "string" }
  ```
- **Response** (`200`):
  ```json
  { "success": true }
  ```

#### `GET /auth/me`

Get the current authenticated user profile.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": { "id", "email", "firstName", "lastName", "role", "tenantId" }
  }
  ```

#### `GET /auth/oauth/google`

Initiate Google OAuth flow (Gmail/Calendar integration).

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Rate Limit**: 20 requests per IP per 10 minutes
- **Response**: Redirect to Google consent screen

#### `GET /auth/oauth/google/callback`

Google OAuth callback (redirected by Google).

- **Auth**: None (public, OAuth callback)
- **Response**: Redirect to app with session token

#### `GET /auth/oauth-session/:id`

Exchange an OAuth session ID for tokens (server-to-server only).

- **Auth**: None (internal use)
- **Response** (`200`):
  ```json
  { "success": true, "data": { "accessToken", "refreshToken", "user" } }
  ```

---

### Contacts

#### `GET /api/v1/contacts`

List contacts with filtering, sorting, and pagination.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `search` — Full-text search
  - `company_id` — Filter by associated company
  - `owner_id` — Filter by owner
  - `tags` — Comma-separated tag filter
  - `page`, `limit` — Pagination (default limit: 50)
  - `sort`, `order` — Sorting (default: `created_at` desc)
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": [{ "id", "first_name", "last_name", "email", "phone", "company_id", "owner_id", "tags", "custom_fields", "created_at", "updated_at" }],
    "pagination": { "total", "page", "limit", "totalPages" }
  }
  ```

#### `GET /api/v1/contacts/:id`

Get a single contact by ID.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  { "success": true, "data": { "id", "first_name", "last_name", "email", "phone", "company_id", "owner_id", "tags", "custom_fields", "activities", "deals" } }
  ```

#### `GET /api/v1/contacts/:id/network`

Get the contact's ego network (graph-based relationship map).

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `depth` — Network traversal depth (default: 2, max: 3)
- **Response** (`200`):
  ```json
  { "success": true, "data": { "nodes": [...], "edges": [...] } }
  ```

#### `POST /api/v1/contacts`

Create a new contact.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "first_name": "string (required)",
    "last_name": "string (required)",
    "email": "string",
    "phone": "string",
    "company_id": "uuid",
    "owner_id": "uuid",
    "tags": ["string"],
    "custom_fields": {}
  }
  ```
- **Response** (`201`):
  ```json
  { "success": true, "data": { "id", ... } }
  ```

#### `PATCH /api/v1/contacts/:id`

Update an existing contact.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**: Partial contact fields
- **Response** (`200`):
  ```json
  { "success": true, "data": { "id", ... } }
  ```

#### `DELETE /api/v1/contacts/:id`

Delete a contact.

- **Auth**: JWT required
- **Role**: `manager` or higher
- **Response** (`200`):
  ```json
  { "success": true }
  ```

---

### Companies

#### `GET /api/v1/companies`

List companies with filtering and pagination.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `search` — Full-text search
  - `industry` — Filter by industry
  - `owner_id` — Filter by owner
  - `page`, `limit` — Pagination
  - `sort`, `order` — Sorting
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": [{ "id", "name", "domain", "industry", "size", "owner_id", "custom_fields", "created_at" }],
    "pagination": { "total", "page", "limit", "totalPages" }
  }
  ```

#### `GET /api/v1/companies/:id`

Get a single company.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `GET /api/v1/companies/by-domain/:domain`

Look up a company by its domain name.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  { "success": true, "data": { "id", "name", "domain", ... } }
  ```

#### `GET /api/v1/companies/:id/detail`

Get detailed company view including contacts, deals, and activity summary.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": {
      "company": { ... },
      "contacts": [...],
      "deals": [...],
      "activitySummary": { "total", "byType": {} }
    }
  }
  ```

#### `POST /api/v1/companies`

Create a new company.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "domain": "string",
    "industry": "string",
    "size": "string",
    "owner_id": "uuid",
    "custom_fields": {}
  }
  ```
- **Response** (`201`):
  ```json
  { "success": true, "data": { "id", ... } }
  ```

#### `PATCH /api/v1/companies/:id`

Update a company.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/companies/:id`

Delete a company.

- **Auth**: JWT required
- **Role**: `manager` or higher

---

### Deals

#### `GET /api/v1/deals`

List deals with filtering and pagination.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `search` — Full-text search
  - `stage` — Filter by pipeline stage
  - `owner_id` — Filter by owner
  - `company_id` — Filter by company
  - `min_value`, `max_value` — Value range filter
  - `page`, `limit` — Pagination
  - `sort`, `order` — Sorting
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": [{ "id", "title", "value", "currency", "stage", "probability", "expected_close_date", "owner_id", "company_id", "contact_ids", "custom_fields" }],
    "pagination": { ... }
  }
  ```

#### `GET /api/v1/deals/:id`

Get a single deal.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `GET /api/v1/deals/:id/timeline`

Get the deal's activity timeline.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  { "success": true, "data": [{ "type", "description", "timestamp", "user" }] }
  ```

#### `GET /api/v1/deals/:id/reality-score`

Get the AI-computed "reality score" for a deal (likelihood to close based on engagement signals).

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  { "success": true, "data": { "score": 0-100, "factors": [...], "recommendation": "string" } }
  ```

#### `POST /api/v1/deals`

Create a new deal.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "title": "string (required)",
    "value": "number",
    "currency": "string (default: USD)",
    "stage": "string (required)",
    "probability": "number (0-100)",
    "expected_close_date": "ISO date",
    "owner_id": "uuid",
    "company_id": "uuid",
    "contact_ids": ["uuid"],
    "custom_fields": {}
  }
  ```
- **Response** (`201`):
  ```json
  { "success": true, "data": { "id", ... } }
  ```

#### `PATCH /api/v1/deals/:id`

Update a deal.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/deals/:id`

Delete a deal.

- **Auth**: JWT required
- **Role**: `manager` or higher

---

### Activities

#### `GET /api/v1/activities`

List activities with cursor-based pagination.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `contact_id` — Filter by contact
  - `company_id` — Filter by company
  - `deal_id` — Filter by deal
  - `type` — Filter by activity type (call, email, meeting, note, task)
  - `owner_id` — Filter by owner
  - `cursor` — Cursor for pagination
  - `limit` — Page size (default: 50)
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": [{ "id", "type", "subject", "body", "duration", "owner_id", "contact_id", "company_id", "deal_id", "participants", "created_at" }],
    "pagination": { "cursor", "hasMore" }
  }
  ```

#### `GET /api/v1/activities/:id`

Get a single activity.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `POST /api/v1/activities`

Create a new activity. Dual-writes to both PostgreSQL and the Apache AGE graph.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "type": "string (required: call|email|meeting|note|task)",
    "subject": "string (required)",
    "body": "string",
    "duration": "number (minutes)",
    "contact_id": "uuid",
    "company_id": "uuid",
    "deal_id": "uuid",
    "participants": [{ "type": "string", "id": "uuid" }]
  }
  ```
- **Response** (`201`):
  ```json
  { "success": true, "data": { "id", ... } }
  ```

#### `PATCH /api/v1/activities/:id`

Update an activity.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/activities/:id`

Delete an activity.

- **Auth**: JWT required
- **Role**: `manager` or higher

---

### Tasks

#### `GET /api/v1/tasks`

List tasks with filtering.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `status` — Filter by status (open, completed, overdue)
  - `assignee_id` — Filter by assignee
  - `contact_id`, `company_id`, `deal_id` — Entity filters
  - `due_before`, `due_after` — Date range filters
  - `page`, `limit` — Pagination
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": [{ "id", "title", "description", "status", "priority", "due_date", "assignee_id", "contact_id", "company_id", "deal_id", "created_at" }],
    "pagination": { ... }
  }
  ```

#### `POST /api/v1/tasks`

Create a new task.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "title": "string (required)",
    "description": "string",
    "status": "string (default: open)",
    "priority": "string (low|medium|high|urgent)",
    "due_date": "ISO date",
    "assignee_id": "uuid",
    "contact_id": "uuid",
    "company_id": "uuid",
    "deal_id": "uuid"
  }
  ```
- **Response** (`201`):
  ```json
  { "success": true, "data": { "id", ... } }
  ```

#### `PATCH /api/v1/tasks/:id`

Update a task.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/tasks/:id`

Delete a task.

- **Auth**: JWT required
- **Role**: `rep` or higher

---

### Users

#### `GET /api/v1/users`

List all users in the workspace.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": [{ "id", "email", "firstName", "lastName", "role", "status", "created_at" }]
  }
  ```

#### `GET /api/v1/users/me`

Get the current user's profile.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `PATCH /api/v1/users/me`

Update the current user's profile.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Request Body**:
  ```json
  {
    "firstName": "string",
    "lastName": "string",
    "phone": "string",
    "avatarUrl": "string"
  }
  ```

#### `POST /api/v1/users`

Create a new user in the workspace.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "email": "string (required)",
    "firstName": "string (required)",
    "lastName": "string (required)",
    "role": "string (required)",
    "password": "string"
  }
  ```

#### `POST /api/v1/users/invite`

Invite a user by email.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "email": "string (required)",
    "role": "string (required)",
    "firstName": "string",
    "lastName": "string"
  }
  ```

#### `PATCH /api/v1/users/:id`

Update another user (role changes, deactivation, etc.).

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `DELETE /api/v1/users/:id`

Deactivate/remove a user.

- **Auth**: JWT required
- **Role**: `admin` or higher

---

### Tenant / Workspace

#### `GET /api/v1/tenant`

Get the current workspace/tenant settings.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  { "success": true, "data": { "id", "name", "plan", "settings", "features", "created_at" } }
  ```

#### `PATCH /api/v1/tenant`

Update workspace settings.

- **Auth**: JWT required
- **Role**: `admin` or `super_admin`
- **Request Body**:
  ```json
  {
    "name": "string",
    "settings": { "timezone": "string", "dateFormat": "string", "currency": "string" }
  }
  ```

---

### Products

#### `GET /api/v1/products`

List products (paginated).

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `GET /api/v1/products/all`

List all products (no pagination, for dropdowns).

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `POST /api/v1/products`

Create a product.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "description": "string",
    "sku": "string",
    "price": "number",
    "currency": "string",
    "active": "boolean"
  }
  ```

#### `PATCH /api/v1/products/:id`

Update a product.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `DELETE /api/v1/products/:id`

Delete a product.

- **Auth**: JWT required
- **Role**: `admin` or higher

---

### Quotes

#### `GET /api/v1/quotes`

List quotes.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `GET /api/v1/quotes/:id`

Get a single quote with line items.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `POST /api/v1/quotes`

Create a quote.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "deal_id": "uuid (required)",
    "title": "string",
    "valid_until": "ISO date",
    "line_items": [
      { "product_id": "uuid", "description": "string", "quantity": "number", "unit_price": "number", "discount_percent": "number" }
    ],
    "notes": "string",
    "terms": "string"
  }
  ```

#### `PATCH /api/v1/quotes/:id`

Update a quote.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/quotes/:id`

Delete a quote.

- **Auth**: JWT required
- **Role**: `manager` or higher

#### `POST /api/v1/quotes/:id/send`

Send a quote to the customer via email.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/quotes/:id/approve`

Approve a quote (triggers approval workflow).

- **Auth**: JWT required
- **Role**: `manager` or higher

#### `POST /api/v1/quotes/:id/status`

Update quote status (e.g., accepted, rejected, expired).

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  { "status": "string (draft|sent|approved|accepted|rejected|expired)" }
  ```

---

### Workflows

#### `GET /api/v1/workflows`

List automation workflows.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/workflows`

Create a workflow.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "trigger": { "type": "string", "conditions": {} },
    "actions": [{ "type": "string", "config": {} }],
    "active": "boolean"
  }
  ```

#### `PATCH /api/v1/workflows/:id`

Update a workflow.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/workflows/:id`

Delete a workflow.

- **Auth**: JWT required
- **Role**: `manager` or higher

#### `GET /api/v1/workflows/:id/runs`

Get execution history for a workflow.

- **Auth**: JWT required
- **Role**: `rep` or higher

---

### Custom Fields

#### `GET /api/v1/custom-fields`

List all custom field definitions.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Query Parameters**:
  - `entity_type` — Filter by entity (contact, company, deal)

#### `POST /api/v1/custom-fields`

Create a custom field definition.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "entity_type": "string (required: contact|company|deal)",
    "name": "string (required)",
    "label": "string (required)",
    "field_type": "string (required: text|number|date|select|multiselect|boolean|url|email|phone)",
    "options": ["string (for select/multiselect)"],
    "required": "boolean",
    "default_value": "any"
  }
  ```

#### `PATCH /api/v1/custom-fields/:id`

Update a custom field definition.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `DELETE /api/v1/custom-fields/:id`

Delete a custom field definition.

- **Auth**: JWT required
- **Role**: `admin` or higher

---

### Custom Objects

#### Object Definitions

#### `GET /api/v1/custom-objects/definitions`

List all custom object definitions.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `POST /api/v1/custom-objects/definitions`

Create a custom object definition.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "label": "string (required)",
    "plural_label": "string (required)",
    "description": "string",
    "fields": [{ "name": "string", "label": "string", "field_type": "string", "required": "boolean" }]
  }
  ```

#### `PATCH /api/v1/custom-objects/definitions/:id`

Update a custom object definition.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `DELETE /api/v1/custom-objects/definitions/:id`

Delete a custom object definition.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### Object Records

#### `GET /api/v1/custom-objects/:objectType/records`

List records for a custom object type.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/custom-objects/:objectType/records/:id`

Get a single custom object record.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/custom-objects/:objectType/records`

Create a custom object record.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `PATCH /api/v1/custom-objects/:objectType/records/:id`

Update a custom object record.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/custom-objects/:objectType/records/:id`

Delete a custom object record.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### Associations

#### `GET /api/v1/custom-objects/:objectType/records/:id/associations`

List associations for a record.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/custom-objects/:objectType/records/:id/associations`

Create an association between records.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `DELETE /api/v1/custom-objects/:objectType/records/:id/associations/:associationId`

Remove an association.

- **Auth**: JWT required
- **Role**: `admin` or higher

---

### Permissions

#### `GET /api/v1/permissions/records/:entityType/:entityId`

Get record-level ACLs for a specific entity.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `PUT /api/v1/permissions/records/:entityType/:entityId`

Set record-level ACLs.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "acl": [{ "userId": "uuid", "level": "read|write|admin" }]
  }
  ```

#### `GET /api/v1/permissions/fields/:entityType`

Get field-level permissions for an entity type.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `PUT /api/v1/permissions/fields/:entityType`

Set field-level permissions.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `GET /api/v1/permissions/defaults`

Get default permission settings.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `PUT /api/v1/permissions/defaults`

Update default permission settings.

- **Auth**: JWT required
- **Role**: `admin` or higher

---

### API Keys

#### `GET /api/v1/api-keys`

List all API keys for the current user.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": [{ "id", "name", "prefix", "scopes", "lastUsedAt", "createdAt", "expiresAt" }]
  }
  ```

#### `POST /api/v1/api-keys`

Create a new API key. The raw key is returned only once.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "scopes": ["crm:read", "crm:write", "ai:read", "ai:write"],
    "expiresAt": "ISO date (optional)"
  }
  ```
- **Response** (`201`):
  ```json
  {
    "success": true,
    "data": { "id", "name", "rawKey": "nxc_...", "prefix", "scopes", "expiresAt" }
  }
  ```

#### `DELETE /api/v1/api-keys/:id`

Revoke an API key.

- **Auth**: JWT required
- **Role**: Any authenticated user

---

### AI

#### `POST /api/v1/ai/nl`

Natural language query against CRM data. Returns structured results.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Rate Limit**: 20 requests per user per minute
- **Request Body**:
  ```json
  {
    "query": "string (required)",
    "context": { "entityType": "string", "entityId": "uuid" }
  }
  ```
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": {
      "answer": "string",
      "sources": [...],
      "structured": { ... },
      "reviewId": "uuid (if flagged for review)"
    }
  }
  ```

#### `GET /api/v1/ai/review-queue`

Get AI responses flagged for human review.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/ai/review-queue/:id/approve`

Approve a flagged AI response.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/ai/review-queue/:id/reject`

Reject a flagged AI response.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/ai/enrich/:entityType/:entityId`

Enrich a single entity (contact/company) with external data.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Response** (`200`):
  ```json
  { "success": true, "data": { "enriched_fields": { ... }, "sources": [...] } }
  ```

#### `POST /api/v1/ai/enrich/batch`

Batch enrich multiple entities.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "entities": [{ "entityType": "string", "entityId": "uuid" }]
  }
  ```

#### `GET /api/v1/ai/forecast`

Get AI-powered revenue forecasting.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Query Parameters**:
  - `period` — Forecast period (quarter, month, year)
  - `pipeline_id` — Filter by pipeline
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": {
      "forecast": { "best_case", "most_likely", "worst_case" },
      "deals": [{ "id", "title", "probability", "predicted_close" }]
    }
  }
  ```

#### `GET /api/v1/ai/explain/:entityType/:entityId/:field`

Get an AI explanation of how a field value was computed (e.g., reality score factors).

- **Auth**: JWT required
- **Role**: `rep` or higher

---

### Outreach — Email

#### `GET /api/v1/outreach/email/threads`

List email threads with cursor-based pagination.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Query Parameters**:
  - `contact_id` — Filter by contact
  - `cursor` — Cursor for pagination
  - `limit` — Page size

#### `GET /api/v1/outreach/email/threads/:id/messages`

Get all messages in a thread.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outreach/email/send`

Send an email. Checks opt-out status and plan quota before sending.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "to": "string (required, email address)",
    "subject": "string (required)",
    "body": "string (required, HTML)",
    "contact_id": "uuid",
    "deal_id": "uuid",
    "thread_id": "uuid (for replies)",
    "track_opens": "boolean (default: true)",
    "track_clicks": "boolean (default: true)"
  }
  ```
- **Response** (`200`):
  ```json
  { "success": true, "data": { "messageId": "string" } }
  ```
- **Error** (`403`): Contact has opted out
- **Error** (`429`): Plan email quota exceeded

#### `POST /api/v1/outreach/email/suggest`

Get AI-suggested email content.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "contact_id": "uuid",
    "deal_id": "uuid",
    "intent": "string (follow-up|intro|proposal|check-in)",
    "context": "string"
  }
  ```

#### `GET /api/v1/outreach/email/unsubscribe`

Public unsubscribe endpoint (included in email footers).

- **Auth**: None (public)
- **Query Parameters**:
  - `token` — Encrypted unsubscribe token
- **Response**: HTML page confirming opt-out

---

### Outreach — Sequences

#### `GET /api/v1/outreach/sequences`

List sequences.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/outreach/sequences/:id`

Get a sequence with its steps.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outreach/sequences`

Create a new sequence.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "steps": [
      {
        "type": "email|wait|task",
        "delay_days": "number",
        "template": { "subject": "string", "body": "string" },
        "config": {}
      }
    ]
  }
  ```

#### `PATCH /api/v1/outreach/sequences/:id`

Update a sequence.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/outreach/sequences/:id`

Delete a sequence.

- **Auth**: JWT required
- **Role**: `manager` or higher

#### `POST /api/v1/outreach/sequences/:id/steps`

Add a step to a sequence.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `PATCH /api/v1/outreach/sequences/:id/steps/:stepId`

Update a sequence step.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/outreach/sequences/:id/steps/:stepId`

Remove a step from a sequence.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outreach/sequences/:id/enroll`

Bulk enroll contacts in a sequence. Validates opt-out status and plan quota.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "contact_ids": ["uuid (required, array)"]
  }
  ```
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": {
      "enrolled": 45,
      "skipped_opted_out": 3,
      "skipped_already_enrolled": 2
    }
  }
  ```

#### `POST /api/v1/outreach/sequences/:id/pause`

Pause a sequence.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outreach/sequences/:id/resume`

Resume a paused sequence.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/outreach/sequences/:id/analytics`

Get sequence performance analytics (open rates, reply rates, completion rates).

- **Auth**: JWT required
- **Role**: `rep` or higher

---

### Outreach — Calls

#### `GET /api/v1/outreach/calls`

List calls with cursor-based pagination.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outreach/calls`

Log a call.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "contact_id": "uuid (required)",
    "direction": "string (inbound|outbound)",
    "duration": "number (seconds)",
    "outcome": "string (connected|voicemail|no_answer|busy)",
    "notes": "string",
    "recording_url": "string"
  }
  ```

#### `PATCH /api/v1/outreach/calls/:id`

Update a call record.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/outreach/calls/:id/recording`

Get the call recording URL.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outreach/calls/token`

Generate a Twilio client token for browser-based calling.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outreach/calls/webhooks/twilio/status`

Twilio call status webhook (inbound from Twilio).

- **Auth**: None (Twilio signature verification)

---

### Outreach — Dialers

#### `GET /api/v1/outreach/dialers/config`

Get the current dialer configuration.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `PUT /api/v1/outreach/dialers/native`

Configure native Twilio dialer credentials.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "accountSid": "string (required)",
    "authToken": "string (required)",
    "phoneNumber": "string (required)"
  }
  ```

#### `DELETE /api/v1/outreach/dialers/native`

Remove native dialer configuration.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `POST /api/v1/outreach/dialers/iframe`

Configure an iframe-based dialer integration.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "provider": "string (required)",
    "iframeUrl": "string (required)"
  }
  ```

#### `DELETE /api/v1/outreach/dialers/iframe`

Remove iframe dialer configuration.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `PATCH /api/v1/outreach/dialers/active`

Set the active dialer type.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  { "type": "string (native|iframe|none)" }
  ```

---

### Inbound Webhooks

These endpoints receive events from third-party services. They do NOT require JWT authentication but use provider-specific signature verification.

#### `POST /api/v1/webhooks/stripe`

Receive Stripe webhook events (subscription changes, payment updates).

- **Auth**: Stripe webhook signature verification (`stripe-signature` header)
- **Events handled**: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`

#### `POST /api/v1/webhooks/zoom`

Receive Zoom webhook events.

- **Auth**: Zoom webhook verification token

#### `POST /api/v1/webhooks/slack`

Receive Slack event API callbacks.

- **Auth**: Slack signing secret verification

---

### Outbound Webhooks

Customer-defined webhooks that fire on CRM events.

#### `GET /api/v1/outbound-webhooks`

List all outbound webhook subscriptions.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outbound-webhooks`

Create an outbound webhook subscription.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "url": "string (required, HTTPS URL)",
    "events": ["string (required, see Webhook Event Types)"],
    "secret": "string (optional, for HMAC signature verification)",
    "active": "boolean (default: true)"
  }
  ```

#### `PATCH /api/v1/outbound-webhooks/:id`

Update an outbound webhook subscription.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/outbound-webhooks/:id`

Delete an outbound webhook subscription.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/outbound-webhooks/:id/test`

Send a test event to the webhook URL.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/outbound-webhooks/:id/deliveries`

Get delivery history for a webhook (successes, failures, response codes).

- **Auth**: JWT required
- **Role**: `rep` or higher

---

### Reports

#### `GET /api/v1/reports/source-fields`

Get available fields for report building, grouped by entity type.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `POST /api/v1/reports/run`

Execute an ad-hoc report query.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Request Body**:
  ```json
  {
    "dataSource": "string (required: contacts|companies|deals|activities)",
    "filters": [{ "field": "string", "operator": "string", "value": "any" }],
    "groupBy": ["string"],
    "metrics": [{ "field": "string", "aggregation": "count|sum|avg|min|max" }],
    "dateRange": { "start": "ISO date", "end": "ISO date" }
  }
  ```

#### `GET /api/v1/reports`

List saved reports.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `POST /api/v1/reports`

Save a report definition.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/reports/:id`

Get a saved report.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `PATCH /api/v1/reports/:id`

Update a saved report.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/reports/:id`

Delete a saved report.

- **Auth**: JWT required
- **Role**: `manager` or higher

#### `POST /api/v1/reports/:id/snapshots`

Create a point-in-time snapshot of report results.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/reports/:id/snapshots`

List snapshots for a report.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `POST /api/v1/reports/:id/subscriptions`

Subscribe to scheduled report delivery (email).

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "frequency": "string (daily|weekly|monthly)",
    "recipients": ["string (email addresses)"],
    "format": "string (pdf|csv)"
  }
  ```

#### `DELETE /api/v1/reports/:id/subscriptions/:subId`

Unsubscribe from a report.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### Datasets

#### `GET /api/v1/reports/datasets`

List saved datasets.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `POST /api/v1/reports/datasets`

Create a reusable dataset definition.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `PATCH /api/v1/reports/datasets/:id`

Update a dataset.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `DELETE /api/v1/reports/datasets/:id`

Delete a dataset.

- **Auth**: JWT required
- **Role**: `manager` or higher

---

### Admin Reports

Platform administration reports (super admin / admin only).

#### `GET /api/v1/admin-reports/types`

List available admin report types.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `POST /api/v1/admin-reports/run`

Run an admin report.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Request Body**:
  ```json
  {
    "type": "string (required)",
    "dateRange": { "start": "ISO date", "end": "ISO date" },
    "filters": {}
  }
  ```

#### `POST /api/v1/admin-reports/feature-usage`

Get feature usage statistics across the platform.

- **Auth**: JWT required
- **Role**: `super_admin`

---

### Billing

#### `POST /api/v1/billing/portal`

Create a Stripe Customer Portal session for managing billing.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Request Body**:
  ```json
  { "returnUrl": "string (optional, default: /settings/billing)" }
  ```
- **Response** (`200`):
  ```json
  { "success": true, "data": { "url": "string (Stripe portal URL)" } }
  ```
- **Error** (`400`): `NO_BILLING_ACCOUNT` — no Stripe customer ID on file
- **Error** (`503`): `BILLING_NOT_CONFIGURED` — Stripe key not set

#### `GET /api/v1/billing/status`

Get current subscription status.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": {
      "plan": "string",
      "stripe_subscription_status": "string (active|past_due|canceled|...)",
      "subscription_period_end": "ISO date",
      "has_billing_account": "boolean"
    }
  }
  ```

---

### Import

#### `POST /api/v1/import/upload`

Upload a CSV/Excel file for import.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Content-Type**: `multipart/form-data`
- **Request Body**:
  - `file` — The file to import
  - `entityType` — Target entity type (contacts, companies, deals)
- **Response** (`200`):
  ```json
  { "success": true, "data": { "jobId": "uuid", "detectedColumns": ["string"], "rowCount": "number" } }
  ```

#### `POST /api/v1/import/:jobId/mapping`

Submit column-to-field mapping for an import job.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "mappings": [{ "sourceColumn": "string", "targetField": "string", "transform": "string (optional)" }],
    "options": { "skipDuplicates": "boolean", "updateExisting": "boolean" }
  }
  ```

#### `GET /api/v1/import/:jobId`

Get import job status and progress.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": {
      "id": "uuid",
      "status": "string (pending|processing|completed|failed|cancelled)",
      "progress": { "total": "number", "processed": "number", "succeeded": "number", "failed": "number" },
      "errors": [{ "row": "number", "message": "string" }]
    }
  }
  ```

#### `GET /api/v1/import/:jobId/preview`

Preview the first N rows with the current mapping applied.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/import/:jobId/cancel`

Cancel a running import job.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/import`

List all import jobs.

- **Auth**: JWT required
- **Role**: `rep` or higher

---

### Export

#### `POST /api/v1/export`

Export CRM data to a file. Returns a pre-signed download URL (expires in 24 hours).

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Request Body**:
  ```json
  {
    "entityType": "string (required: contacts|companies|deals|activities)",
    "format": "string (required: json|csv)",
    "filters": {},
    "fields": ["string (optional, specific fields to include)"]
  }
  ```
- **Response** (`200`):
  ```json
  { "success": true, "data": { "downloadUrl": "string (pre-signed S3/R2 URL, 24h expiry)", "expiresAt": "ISO date" } }
  ```

---

### Bulk Operations

#### `POST /api/v1/bulk/update`

Bulk update up to 500 records.

- **Auth**: JWT required
- **Role**: `rep` or higher
- **Request Body**:
  ```json
  {
    "entityType": "string (required)",
    "ids": ["uuid (required, max 500)"],
    "changes": { "field": "value" }
  }
  ```
- **Response** (`200`):
  ```json
  { "success": true, "data": { "updated": "number", "failed": "number", "errors": [] } }
  ```

#### `POST /api/v1/bulk/delete`

Bulk delete up to 500 records.

- **Auth**: JWT required
- **Role**: `manager` or higher
- **Request Body**:
  ```json
  {
    "entityType": "string (required)",
    "ids": ["uuid (required, max 500)"]
  }
  ```
- **Response** (`200`):
  ```json
  { "success": true, "data": { "deleted": "number", "failed": "number" } }
  ```

---

### Integrations

#### `GET /api/v1/integrations`

List configured integrations and their status.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response** (`200`):
  ```json
  {
    "success": true,
    "data": [{ "provider": "string", "status": "connected|disconnected", "connectedAt": "ISO date" }]
  }
  ```

#### `GET /api/v1/integrations/gmail/connect`

Initiate Gmail OAuth connection.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Response**: Redirect to Google consent screen

#### `GET /api/v1/integrations/gmail/callback`

Gmail OAuth callback.

- **Auth**: None (OAuth callback)

#### `GET /api/v1/integrations/outlook/connect`

Initiate Microsoft Outlook OAuth connection.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `GET /api/v1/integrations/outlook/callback`

Outlook OAuth callback.

- **Auth**: None (OAuth callback)

---

### Slack Integration

#### `GET /api/v1/slack/connect`

Initiate Slack OAuth flow.

- **Auth**: JWT required
- **Role**: `admin` or higher
- **Response**: Redirect to Slack consent screen

#### `GET /api/v1/slack/callback`

Slack OAuth callback.

- **Auth**: None (OAuth callback)

#### `POST /api/v1/slack/interactions`

Slack interactive component webhook (button clicks, modals).

- **Auth**: None (Slack signing secret verification)

#### `GET /api/v1/slack/status`

Get Slack integration status.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `GET /api/v1/slack/users`

List mapped Slack users.

- **Auth**: JWT required
- **Role**: `rep` or higher

#### `POST /api/v1/slack/users/sync`

Sync Slack users with CRM users.

- **Auth**: JWT required
- **Role**: `admin` or higher

#### `DELETE /api/v1/slack/disconnect`

Disconnect Slack integration.

- **Auth**: JWT required
- **Role**: `admin` or higher

---

### Graph Queries

Advanced graph-based queries powered by Apache AGE.

#### `GET /api/v1/graph/stalling-deals`

Find deals that have stalled (no activity in N days).

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `days` — Stall threshold in days (default: 14)

#### `GET /api/v1/graph/ego-network/:entityType/:entityId`

Get the ego network (relationship graph) for any entity.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `depth` — Traversal depth (default: 2, max: 3)

#### `GET /api/v1/graph/intro-path/:fromId/:toId`

Find the shortest introduction path between two contacts.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `GET /api/v1/graph/buying-group/:dealId`

Identify the buying group (decision-makers, influencers, champions) for a deal.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `GET /api/v1/graph/at-risk-accounts`

Find accounts at risk based on engagement decay and relationship signals.

- **Auth**: JWT required
- **Role**: Any authenticated user

#### `GET /api/v1/graph/dark-contacts`

Find "dark" contacts with no recent engagement.

- **Auth**: JWT required
- **Role**: Any authenticated user
- **Query Parameters**:
  - `days` — Days since last engagement (default: 30)

---

### Super Admin — Tenant Management

These endpoints are only accessible to `super_admin` users and are used for platform-wide administration.

#### `GET /api/v1/admin/tenants`

List all tenants/workspaces on the platform.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `POST /api/v1/admin/tenants`

Create a new tenant/workspace.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `GET /api/v1/admin/tenants/:id`

Get a specific tenant.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `PATCH /api/v1/admin/tenants/:id`

Update tenant settings/plan.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `DELETE /api/v1/admin/tenants/:id`

Delete a tenant.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `GET /api/v1/admin/tenants/:id/users`

List users within a tenant.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `POST /api/v1/admin/tenants/:id/features`

Toggle feature flags for a tenant.

- **Auth**: JWT required
- **Role**: `super_admin`
- **Request Body**:
  ```json
  { "feature": "string", "enabled": "boolean" }
  ```

#### `GET /api/v1/admin/tenants/:id/settings`

Get tenant settings.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `PATCH /api/v1/admin/tenants/:id/settings`

Update tenant settings.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `POST /api/v1/admin/tenants/:parentId/sub-workspaces`

Create a sub-workspace under a parent tenant.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `GET /api/v1/admin/stats`

Get platform-wide statistics.

- **Auth**: JWT required
- **Role**: `super_admin`

#### `POST /api/v1/admin/tenants/merge`

Merge two workspaces.

- **Auth**: JWT required
- **Role**: `super_admin`
- **Request Body**:
  ```json
  { "sourceId": "uuid", "targetId": "uuid" }
  ```

---

## Error Response Format

All errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description"
  }
}
```

Common error codes:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `FORBIDDEN` | 403 | Insufficient RBAC role |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `UPSTREAM_UNAVAILABLE` | 503 | Backend service unreachable |
| `BILLING_NOT_CONFIGURED` | 503 | Stripe not configured |
| `NO_BILLING_ACCOUNT` | 400 | Tenant has no Stripe customer |

---

## Multi-Tenancy

All data is tenant-scoped. The `tenantId` is extracted from JWT claims and automatically applied to every query. There is no way to access data across tenants unless using `super_admin` platform-level endpoints.

## Encryption

- **OAuth tokens**: Encrypted at rest with AES-256-GCM
- **API key secrets**: SHA-256 hashed (raw key shown only at creation time)
- **Passwords**: bcrypt hashed

## Background Processing

The following operations run asynchronously via BullMQ:

- Import jobs (CSV/Excel processing)
- Outbound webhook delivery (with retry logic)
- Sequence step execution
- AI enrichment batch jobs
- Report snapshot generation

---

## Admin Routes (Gateway)

Admin operations are proxied through the API gateway at `/api/admin/*` to the auth service's internal admin endpoints. All routes require `super_admin` role and reject API keys.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/tenants` | List all tenants |
| POST | `/api/admin/tenants` | Create a tenant |
| GET | `/api/admin/tenants/:id` | Get tenant details |
| PATCH | `/api/admin/tenants/:id` | Update tenant |
| PATCH | `/api/admin/tenants/:id/features` | Toggle tenant features |
| PATCH | `/api/admin/tenants/:id/settings` | Update tenant settings |
| GET | `/api/admin/tenants/:id/users` | List tenant users |
| GET | `/api/admin/tenants/:id/children` | List sub-workspaces |
| POST | `/api/admin/tenants/:id/sub-workspaces` | Create sub-workspace |
| GET | `/api/admin/tenants/:id/stats` | Tenant statistics |
| GET | `/api/admin/stats/platform` | Platform-wide stats |
| POST | `/api/admin/merges` | Create workspace merge |
| GET | `/api/admin/merges/:id` | Get merge details |
| PATCH | `/api/admin/merges/:id` | Update merge resolutions |
| POST | `/api/admin/merges/:id/execute` | Execute merge |
| POST | `/api/admin/merges/:id/cancel` | Cancel merge |

> **Note:** Web clients may continue using Next.js server-side `/api/admin/*` handlers that call auth:4001 directly. Mobile clients should use these gateway routes.

---

## Not Yet Implemented

The following endpoints are referenced in the mobile app but do not yet have backend implementations:

- `/api/v1/insights/*` — Sales insights (activity, engagement, pipeline, team)
- `/api/v1/admin/roles` — Custom role management
- `/api/v1/admin/system-health` — System health dashboard
- `/api/v1/admin/data/export`, `/api/v1/admin/data/retention` — Data management
- `/api/v1/admin/gdpr/requests` — GDPR requests (use `/api/v1/compliance/dsr` instead)
- `/api/v1/admin/features` — Feature management (use `/api/admin/tenants/:id/features` instead)
