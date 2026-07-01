# Integration tests (live Postgres + Redis)

These exercise the ingestion pipeline and the anomaly detector against a **real**
PostgreSQL 16 and Redis — no mocks — closing the gap that unit tests and
`py_compile` can't cover (asyncpg type handling, real SQL, Redis stream
consumers).

## What they prove

- **`test_pipeline.py`** — the "zero-entry" claim end to end: a raw Gmail payload
  is normalized, the sender is resolved to an existing contact, and the email is
  persisted as a `crm_events` row linked to that contact. Also covers the
  review-queue and crm-writes (`entity.created`) persisters.
- **`test_anomaly_scan.py`** — the anomaly detector really writes `anomaly_alerts`
  (stalled deal, ghost deal, at-risk account), does **not** flag a healthy deal,
  and is idempotent across re-scans.
- **`test_dead_letter.py`** — a poison message is parked on a `*:dead-letter`
  stream (not silently dropped) and the consumer group keeps processing.

## Run

```bash
# Provisions a throwaway Postgres + Redis if DATABASE_URL/REDIS_URL are unset:
tests/integration/run.sh

# …or point at your own:
DATABASE_URL='postgresql://user@host/db' REDIS_URL='redis://localhost:6379' \
  tests/integration/run.sh
```

`schema.sql` is the minimal relational subset of the production migrations (the
Apache AGE / pgvector objects are omitted so the tests run on a stock Postgres).
