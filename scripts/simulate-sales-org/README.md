# Sales-org simulation

Drives a realistic sales organisation through NexCRM's **public API only** (no
SQL), then verifies the result. Default: 203 each of accounts, contacts,
opportunities and leads.

| Object | What happens |
|---|---|
| Users | 2 managers, 4 SDRs (inbound pod), 6 AEs (one EMEA) under a role hierarchy; private sharing model |
| Accounts | 55% prospects, 30% existing customers, 15% churned (with churn reason + date); later some customers churn |
| Contacts | spread over 150 accounts (buying committees on 40); 0–5 campaign memberships each (8 campaigns) |
| Opportunities | new business / expansion / win-back; pre-qualified → qualified → discovery → proposal (quote from a price book, discount approvals by the manager chain, sync) → negotiation (quote sent) → won (quote accepted) or lost at any stage. Contact roles: champion is main POC, champion ≠ POC, POC only, none; one champion per account reused across its deals |
| Leads | 45 for existing contacts, 70 at existing accounts, 88 net-new; received via the public web-to-lead form or the API; routed by assignment rules (EMEA → EMEA AE, inbound → SDR round-robin, rest → AE round-robin); worked (new → working → nurturing / unqualified → re-qualified → qualified, with logged calls); matched (`/leads/:id/matches`); handed off to the account owner when they match; **all converted** — into the existing contact, onto the existing account, or as a new prospect account; ~45% create an opportunity |
| Automation | speed-to-lead task per assigned lead, negotiation prep task + manager notice, churn alert to the manager |

Verified: lifecycle statuses (wins promote prospects/churned → customer),
campaign memberships, stage + full stage history, main POC uniqueness,
account champion, quotes/approvals, zero duplicate people, routing balance,
hand-offs, workflow run counts, sharing, and report totals (exact on a fresh
tenant).

## Run

```bash
# Local dev (mints JWTs; the admin user must already exist in the tenant)
GATEWAY_URL=http://localhost:4000 JWT_SECRET=… TENANT_ID=… ADMIN_USER_ID=… \
  node scripts/simulate-sales-org/simulate.mjs

# Any instance (real logins; the script creates the sales users with a password)
GATEWAY_URL=https://api.example.com TENANT_SLUG=acme ADMIN_EMAIL=… ADMIN_PASSWORD=… \
  node scripts/simulate-sales-org/simulate.mjs
```

Options: `SIM_COUNT` (default 203), `SIM_SEED`, `SIM_CONCURRENCY` (6),
`SIM_PRIVATE_SHARING` (true — **sets the tenant's sharing defaults to Private**),
`SIM_TAG`, `SIM_OUT_DIR`. Every run creates new, tagged records and users; it
never deletes anything. Use a dedicated tenant: report totals are exact only on
a fresh one. The script honours `Retry-After` on 429s; the gateway allows
`GATEWAY_RATE_LIMIT_MAX` requests per user per minute (default 200).

Output: `out/report-<tag>.json` and `.md`. `sample-report.md` is a 31/31 run.
