# Load test at production volume

How the numbers below were produced, and what they do and do not show.

## Setup

- Data: one workspace, 120 users (1 admin, 2 VPs, 12 managers, 105 reps), private
  sharing model. 20,000 accounts, 100,000 contacts, 10,000 leads, 50,000
  opportunities, 1,000,000 activities, 300,000 events (`scripts/load-test/seed.sql`).
- Driver: `scripts/load-test/run.mjs` — N users at once, each making a request
  every ~1 s from a weighted mix of 20 actions (lists, record pages, search,
  dashboard, reports, and writes: log activity, update opportunity, create
  contact, create task). Budget: p95 under 1 s and under 1 % errors.
- Machine: one 4-core / 15 GB box running Postgres, Redis, all services (in dev
  mode via tsx, one process each) and the load driver together.

"80 users at once, one request per second each" is much heavier than 80 logged-in
people: a 120-seat team rarely has more than 20–40 people clicking in the same
second.

## Results

| Run | Requests/s | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| Before any change, 1 user, record page | — | ~1,000 ms | — | — | — |
| Before any change, 1 admin, opportunity list | — | 9,000–10,000 ms (timed out) | — | — | — |
| 80 users, indexes + page-first lists only | 20 | 3,236 ms | 5,544 ms | 6,465 ms | 0 % |
| 80 users, all fixes below | 72 | 61 ms | 380 ms | 862 ms | 0 % |
| 120 users, all fixes below | 84 | 261 ms | 1,389 ms | 2,861 ms | 3.7 % (all HTTP 429) |

The 120-user run is past this machine's capacity (about 80 requests/s). Its
errors are the gateway's per-IP rate limit (5,000/min in the test config; the
driver sends everything from one address), not failures.

## What was wrong and what changed

1. **The graph tables had no indexes at all** — Apache AGE creates none, and none
   were added. Every lookup scanned every tenant's records. Migration
   `065_graph_indexes.sql` adds them. Record pages: ~1,000 ms → ~25 ms.
2. **List screens joined related records for every row before paging.** They now
   page first and join only the 50 rows shown. Admin opportunity list: 10 s → 280 ms.
3. **The sharing filter could not use an index.** `owner_id IN $param` compiles to
   a function no index serves; it is now a validated literal list. Rep lists:
   ~95 ms → ~8 ms in the database.
4. **Whole-workspace totals were recomputed on every request.** List totals and the
   opportunity aggregate behind the dashboard, forecast and pipeline report are
   now shared for 15 s (`LIST_COUNT_TTL_MS`, `AGGREGATE_TTL_MS`), and concurrent
   requests share one query. Consequence: a total can be up to 15 s stale.

## What this does not show

- **Not production hardware or topology.** No separate database server, no
  replicas, no load balancer, no TLS, services in dev mode. Absolute numbers
  will differ; the before/after ratios are the reliable part.
- **One workspace.** Many workspaces of this size share the same graph tables;
  the indexes make lookups independent of other tenants, but that was not
  measured.
- **One minute, not hours.** No soak test, so no evidence about memory growth,
  connection leaks or table bloat.
- **Still expensive by design:** an unfiltered sort or text search over a whole
  workspace (admin/VP lists, global search) reads every record of that type —
  roughly 250 ms per 50,000 records of database CPU. That is the ceiling on this
  design; removing it means keeping a relational copy of the list fields, which
  has not been built.
- **Workflows, email sending, imports and the AI engine were idle** during the run.

## Re-running

```bash
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/load-test/seed.sql   # ~75 s
scripts/dev-stack.sh start
JWT_SECRET=... node scripts/load-test/run.mjs probe          # one user, each screen once
JWT_SECRET=... node scripts/load-test/run.mjs load 80 60     # exits non-zero if over budget
```
