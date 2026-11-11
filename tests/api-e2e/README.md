# API end-to-end suites

Run against a live stack (gateway + graph-core + auth, Postgres with Apache AGE,
Redis). Each suite seeds its own fresh tenant, so runs are repeatable.

| Suite | Covers |
|---|---|
| `lead-to-quote.mjs` (88) | sharing model + role hierarchy, assignment, web-to-lead, conversion, validation rules, price books, multi-level approvals, PDF, sync, reports, deactivation |
| `connectivity.mjs` (36) | event bus → workflows → cross-module actions, delays, loop guard, webhooks, search/GraphQL sharing, merge, timeline, integrations |
| `auth.mjs` (42) | real registration/password login, brute-force guard, refresh rotation + reuse detection, logout, deactivation, SCIM 2.0, SAML SSO against a mock IdP |

```bash
scripts/dev-stack.sh start          # needs DATABASE_URL + REDIS_URL reachable (see .stack.env)
set -a; . .stack.env; set +a
GATEWAY_URL=http://localhost:4000 node tests/api-e2e/lead-to-quote.mjs
GATEWAY_URL=http://localhost:4000 node tests/api-e2e/connectivity.mjs
GATEWAY_URL=http://localhost:4000 node tests/api-e2e/auth.mjs
scripts/dev-stack.sh stop
```

`tests/api-e2e/run.sh` does all of that (used by CI).
