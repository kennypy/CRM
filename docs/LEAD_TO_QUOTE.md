# Lead-to-Quote: capability matrix and gaps

The benchmark is the Lead-to-Quote scope of an enterprise sales CRM (the
Salesforce Sales Cloud *Enterprise* edition tier), for one tenant running a
120-person sales team. This page lists what NexCRM does, how it is enforced,
and what is still missing. **Missing items are listed on purpose. Do not
describe NexCRM as "at parity" while section 3 has entries.**

Verification for this release:
- `vitest` unit suites: 174 tests across the gateway, graph-core, auth, outreach and web.
- An end-to-end run against Postgres 16 + Apache AGE + Redis, with the
  least-privilege DB roles: 88/88 checks. It covers every flow in section 1,
  across five users in a three-level manager hierarchy and a second tenant.

---

## 1. Implemented

### Leads
| Capability | How |
|---|---|
| Lead capture (UI, API, import) | `POST /api/v1/contacts` with `isLead: true` |
| **Web-to-lead** | `POST /public/web-to-lead/:formKey`: per-form unguessable key, optional origin allow-list, 10/min/IP rate limit, honeypot field, duplicate-email suppression, `retURL` redirect only to an allow-listed origin. Accepts JSON or a plain HTML form post. |
| **Lead assignment rules** | Priority-ordered rules over source, country, title, seniority, email, company and custom fields. Each rule assigns to a user or **round-robin across a team**; the cursor is row-locked so concurrent leads never break the rotation. Runs on every lead create without an owner, on web-to-lead, and on demand (`POST /leads/:id/assign`). |
| **Lead conversion** | `POST /api/v1/leads/:id/convert`. The account is matched by id, then by email/website domain (free-mail ignored), then by exact name, or created. Creates the contact and, optionally, an opportunity with the contact as primary contact role. **One Postgres transaction** covers the graph writes and the audit row, so a failed conversion leaves no half-converted lead. Re-conversion returns 409. Validation rules apply to the opportunity being created. |
| Conversion reporting | `lead_registry` (denominator) and `lead_conversions` (numerator). |

### Opportunities
| Capability | How |
|---|---|
| Stages, amounts, close dates, multi-currency | Existing deal model + exchange rates |
| **Paginated lists** | `offset`/`limit`, `total`, `hasMore`, plus `ownerId` and `scope=mine\|team\|all`. Previously capped at 200 rows with no paging. |
| **Field history tracking** | Stage, amount, currency, close date, owner, probability and name changes go to `field_history` with the acting user (`GET /deals/:id/history`). Contacts track owner, lead flag, email and source. |
| **Opportunity teams** | `GET/PUT /deals/:id/team`; members get read or read/write access to the record. |
| **Opportunity splits** | `GET/PUT /deals/:id/splits`; revenue splits must total 100%, overlay splits are free-form. |
| Contact roles | `INFLUENCES` edges, with the primary contact set on conversion |

### Quotes / CPQ-lite
| Capability | How |
|---|---|
| **Price books** | Per-currency books with one standard book per tenant; entries per product. A quote using a book is priced from it. |
| **Discounts measured against list price** | Each line stores `list_price`. Approval looks at the real discount from list, so typing a lower unit price no longer avoids approval. |
| **Multi-step approval processes** | `POST /quotes/:id/submit-for-approval` builds a chain from the submitter's **manager hierarchy**: one level, plus one per discount tier exceeded (discount % or total contract value), falling back to admins. The record is locked while pending. The submitter can never approve their own request; reject needs a comment; recall is supported. Approvers get in-app notifications. Inbox: `GET /api/v1/approvals`. |
| Approval durability | An approval covers the discount level it was granted at. Any edit that raises the discount above that level needs a new approval, including a change to the order-level discount alone (this used to skip the check). |
| Status guards | A quote cannot be sent, viewed, accepted or rejected while it needs approval. Before this release it could be marked "accepted" without approval. |
| **Quote PDF** | `GET /quotes/:id/pdf`, rendered on the server (multi-page, totals, terms, draft/pending watermark). |
| **Quote ↔ opportunity sync** | `POST /quotes/:id/sync`: one synced quote per deal (unique index), and the deal amount follows the synced quote, including on later edits. |
| Quote numbering | Gap-free per tenant per year (`Q-2026-0001`). The old random 4-digit suffix could produce duplicates. |

### Data quality and adaptability
| Capability | How |
|---|---|
| **Validation rules** | Rules per object (contact, company, deal, quote) written as a JSON condition tree (`all`/`any`/`not`, 13 operators including `changed`). A save is blocked when the condition is true. Rules are evaluated at the gateway against the merged after-write record and return 422 `VALIDATION_RULE` with the field. No `eval`, prototype-safe, depth-capped. Admin: `/api/v1/validation-rules`, with a `/test` dry-run. |
| Custom fields / custom objects | Existing |
| Workflow automation | Existing workflow engine (now leader-locked, so it runs once with several replicas) |

### Security, users, sharing
| Capability | How |
|---|---|
| **Org-wide defaults + role hierarchy** | Under a Private default, a record is visible to its owner, **everyone above the owner in the manager chain**, teammates (team access), opportunity-team members and explicit shares. **List endpoints are filtered too**; before this release only single-record reads were checked. |
| Owner access bug fixed | Under a Private default, record **owners were denied their own records** because `owner_access` and `team_access` were never evaluated. |
| **User deactivation** | Deactivating replaces hard delete, which orphaned records and failed with a foreign-key error for anyone who had created a quote. Deactivation revokes sessions immediately and transfers contacts, accounts, open opportunities, open quotes and assignment rules. Pending approvals are re-routed and direct reports re-parented. Reactivation is supported. |
| Hierarchy integrity | Manager cycles are rejected, and `GET /users/hierarchy` returns the role tree. |
| SSO/SAML, SCIM, MFA-capable auth, field-level security, record ACLs, RLS, per-tenant encryption, legal holds, audit log | Existing |

### Reporting
`GET /api/v1/reports/standard/:key?from&to` provides lead conversion by source and by owner, pipeline by stage and owner, average time in stage (from field history), win rate by owner, quote approval cycle time and quotes by status. The reports follow the sharing model. The existing report builder, dashboards, forecasting and scheduled delivery are unchanged.

### Platform
See `docs/OPERATIONS.md` for:
- health and readiness probes and graceful shutdown;
- Idempotency-Key support and a uniform error envelope with request ids;
- SLO burn-rate alerts and the Helm chart (2+ replicas, PDBs, HPA, zone spread);
- CloudNativePG HA Postgres with PITR;
- runbooks.

### Defects fixed while building this
- **Shared RLS pool hang:** in `packages/service-common`, every non-request `pool.query` hung forever once `DATABASE_URL_APP` was set. That env var is the recommended production setting.
- **Missing graph labels:** on a fresh install, the least-privilege service role could not create AGE labels, so the first contact create failed. Fixed by migration 062.
- **Fake notifications:** `/api/v1/notifications` served hard-coded demo notifications to real users because its tables were never migrated.

---

## 2. API summary (new)

```
POST   /api/v1/leads/:id/convert
POST   /api/v1/leads/:id/assign
GET|POST          /api/v1/leads/assignment-rules     PATCH|DELETE /:id
GET|POST          /api/v1/leads/web-forms            PATCH|DELETE /:id
POST   /public/web-to-lead/:formKey                         (public)
GET|POST          /api/v1/price-books                GET|PATCH|DELETE /:id
GET|PUT           /api/v1/price-books/:id/entries
POST   /api/v1/quotes/:id/submit-for-approval
GET    /api/v1/quotes/:id/pdf
POST   /api/v1/quotes/:id/sync
GET    /api/v1/approvals?scope=mine|submitted|all&status=
GET    /api/v1/approvals/:id      POST /:id/approve|reject|recall
GET|POST          /api/v1/validation-rules           PATCH|DELETE /:id   POST /test
GET    /api/v1/deals/:id/history
GET|PUT           /api/v1/deals/:id/team             /api/v1/deals/:id/splits
GET    /api/v1/deals?offset=&limit=&ownerId=&scope=mine|team|all   (also contacts, companies)
GET    /api/v1/reports/standard   GET /api/v1/reports/standard/:key
GET    /api/v1/users/hierarchy    POST /api/v1/users/:id/deactivate|reactivate
```

Schema: migrations `061_lead_to_quote.sql` and `062_age_labels.sql`.

---

## 3. Not at parity yet (known gaps)

Ranked by how likely each is to block a 120-rep sales org:

| Gap | Impact | Effort |
|---|---|---|
| **Quote email delivery.** `POST /quotes/:id/send` only flips the status; it does not email the PDF. Reps must download and attach it. | High: everyday workflow | Small (outreach email service exists) |
| **Load at real data volume is unproven.** Deal, contact and company lists now run a count query plus a page query on Apache AGE. Nobody has measured this at 50k deals / 2M activities. | High: this is the load-bearing risk; see OPERATIONS §7–8 | Medium (run `tests/load` on production-sized data) |
| Record types and per-profile page layouts | Medium for multi-segment teams | Large |
| Criteria-based sharing rules (e.g. "share all EMEA deals with EMEA managers"). Only owner/hierarchy/team/manual shares exist. | Medium | Medium |
| Lead queues as owners. Round-robin to a team covers most uses, but there is no "unassigned queue" inbox. | Medium | Small |
| Splits are not yet included in forecast rollups | Medium for overlay-heavy orgs | Small |
| Branded or custom quote templates (one built-in layout) | Low–medium | Medium |
| Duplicate/matching rules on manual record creation (only web-to-lead dedupes) | Medium | Medium |
| Field history for companies/accounts | Low | Small |
| Product schedules, product families, bundles (CPQ) | Low for L2Q; high if subscription CPQ is needed | Large |
| Bulk async API (10k+ record jobs) | Low (import/export jobs exist) | Medium |
| Flutter mobile app does not expose the new L2Q screens | Medium if reps work mobile-first | Medium |
| The validation-rule cache is per replica (≤30s staleness after an admin edit) | Low | Small (Redis pub/sub invalidation) |
