# NexCRM Operations Guide

How NexCRM is run, measured and recovered in production. Target: a 120-seat
sales org with a **99% monthly availability SLO**.

---

## 1. SLO

| | |
|---|---|
| **Objective** | 99% availability over a rolling 30 days |
| **Error budget** | 1% = **7h 18m** of full outage per 30 days (≈ 1h 41m per week) |
| **SLI 1 — request-based** | Share of api-gateway responses that are not 5xx, excluding `/health*` probes |
| **SLI 2 — synthetic** | Share of 15-second blackbox probes of `/health/ready` that return 200 with `"status":"ok"` |
| **Scope** | api-gateway (every client and API call passes through it). auth, graph-core and outreach are probed individually so the failing tier is obvious. |

Why two SLIs: the request-based SLI is blind when the gateway is completely
down (no requests reach it, so there are no 5xx to count). The synthetic probe
covers that case. Both must be ≥ 99%.

**Not in the SLO:** the AI features (ai-engine / LLM provider latency and
outages), third-party integrations (Gmail, Zoom, Slack, Twilio, Stripe) and
background job latency. Those degrade features; they don't make the CRM
unavailable. Track them separately.

### How it is measured

- Services export OTel metrics → otel-collector → Prometheus remote-write.
  `resource_to_telemetry_conversion` copies `service.name` onto each series as
  `service_name`.
- Recording rules: `infra/prometheus/rules/slo-recording.yml`
  (`nexcrm:gateway_error_ratio:rate{5m,30m,1h,6h,1d,3d,30d}`,
  `nexcrm:gateway_error_budget_remaining:ratio_30d`,
  `nexcrm:probe_availability:ratio_30d`).
- The rules accept both OTel HTTP semconv variants
  (`http_server_duration_milliseconds` / `http_status_code` and
  `http_server_request_duration_seconds` / `http_response_status_code`).
  **After first deploy, confirm in Prometheus that `nexcrm:gateway_requests:rate5m`
  has data.** If it doesn't, the `TelemetryPipelineDown` alert fires and the
  burn-rate alerts are blind.
- Dashboard: Grafana → **NexCRM — SLO & Error Budget**
  (`infra/grafana/dashboards/nexcrm-slo.json`).

---

## 2. Alerts and routing

Defined in `infra/prometheus/rules/alerts.yml`, routed by
`infra/alertmanager/alertmanager.tmpl.yml`. The receiver URL is
`ALERT_WEBHOOK_URL` (Slack incoming webhook, PagerDuty Events v2 bridge,
Opsgenie, etc.) — never committed.

| Alert | Severity | Fires when |
|---|---|---|
| GatewayErrorBudgetFastBurn | page | 5xx ratio > 14.4% over 1h **and** 5m (2% of monthly budget per hour) |
| GatewayErrorBudgetSlowBurn | page | 5xx ratio > 6% over 6h **and** 30m |
| GatewayErrorBudgetLow | ticket | < 25% of the 30-day budget left |
| ServiceDown | page | any `/health/ready` probe failing for 2 min |
| ProbeAvailabilityBelowSLO | ticket | 30-day synthetic availability < 99% |
| GatewayHighLatencyP95 | ticket | gateway p95 > 1.5s for 10 min |
| PostgresDown | page | postgres-exporter `pg_up == 0` |
| PostgresConnectionsNearLimit | ticket | > 85% of `max_connections` |
| RedisDown | page | redis-exporter `redis_up == 0` |
| RedisMemoryHigh | ticket | > 90% of `maxmemory` |
| TelemetryPipelineDown | ticket | gateway is up but no request metrics arrive |

Inhibitions: `ServiceDown` suppresses the burn-rate pages; `PostgresDown` /
`RedisDown` suppress `ServiceDown` on dependents.

**Paging needs a human on the other end.** A 99% SLO assumes someone
acknowledges a page within ~15 minutes, around the clock or at least during
the customer's working hours. Without that rota, the alerts are only
notifications.

---

## 3. Runbooks

### Runbook: ServiceDown
1. `curl -s https://api.<domain>/health/ready | jq` — the `dependencies` map
   names the failing check (postgres / redis / graph-core / auth) and its error.
2. Dependency failing → jump to that runbook. If `status: shutting_down`, a
   rollout is in progress; check `kubectl rollout status deploy/nexcrm-<svc>`.
3. All pods failing liveness → `kubectl logs -l app.kubernetes.io/name=<svc> --previous`.
   Crash loop after a deploy → **roll back first, debug second** (§6).
4. Pods healthy but probe fails → ingress / DNS / TLS certificate expiry.

### Runbook: GatewayErrorBudgetBurn
1. Grafana → NexCRM Overview → "Top routes by p95" / 5xx by route; Loki:
   `{service_name="api-gateway"} |= "Request error"`.
2. Every error response carries `requestId` (also in the `x-request-id`
   header); search Loki/Tempo by it to find the downstream failure.
3. Started with a deploy? Roll back. Concentrated on one downstream
   (graph-core 5xx, AGE errors)? Check that service's readiness and Postgres.
4. Caused by an upstream provider (LLM, Gmail)? Those routes should return
   502/503 quickly; if they hang, raise the issue — timeouts belong in code.

### Runbook: GatewayErrorBudgetLow
Freeze non-urgent deploys and schema migrations until the budget recovers.
Review the biggest burn events in the SLO dashboard and fix their causes.

### Runbook: GatewayHighLatencyP95
1. Check which routes (Overview dashboard) and DB p95 (`db_client_operation_duration`).
2. AGE/Cypher queries are the usual suspect: look for sequential scans on
   `nexcrm_graph` label tables (`pg_stat_statements`), missing property indexes.
3. Pods CPU-throttled? HPA at max? Raise `maxReplicas` or requests.

### Runbook: PostgresDown
1. CNPG: `kubectl cnpg status nexcrm-pg`. A primary failure should promote a
   sync replica automatically within ~30s; services reconnect on their own.
2. No healthy instance → restore (§5). Do **not** delete PVCs.
3. Connections near limit → check for leaked transactions
   (`pg_stat_activity where state = 'idle in transaction'`), confirm services
   go through the PgBouncer pooler, lower `DATABASE_POOL_MAX` per pod.

### Runbook: RedisDown
Effects (request-path Redis calls use a fail-fast client with a 500ms
command timeout, so nothing hangs):
- Already-signed-in users keep working: gateway and graph-core rate limiting
  is skipped, the access-token deny-list check fails open, idempotency keys
  fail open.
- **New logins / token refreshes fail** — the auth service's brute-force rate
  limiter fails closed by design. This counts against the SLO once access
  tokens (15 min) expire, so Redis HA is not optional.
- Workflow engine and scheduled reports pause (leader lock fails closed);
  BullMQ queues stop until Redis returns.
1. Managed Redis: check the provider's failover status.
2. After recovery, BullMQ resumes; delayed/repeatable jobs are re-scheduled.
   Check `export_jobs`, `import_jobs` and `outbound_webhook_deliveries` for
   rows stuck `processing` and re-enqueue them.

### Runbook: TelemetryPipelineDown
The otel-collector or the Prometheus remote-write receiver is broken, or
metric names changed (semconv upgrade). Fix before trusting any SLO number.

---

## 4. Health endpoints

Every Node service (api-gateway, auth, graph-core, outreach):

| Path | Meaning |
|---|---|
| `/health` | Legacy liveness, unchanged response shape |
| `/health/live` | Process is up → 200. Used by liveness/startup probes |
| `/health/ready` | Postgres `SELECT 1`, Redis `PING` (and for the gateway: graph-core + auth `/health/live`) each within 2s → 200, else 503 with per-dependency status. 503 while shutting down |

All three are exempt from auth, service-token and rate limiting.
The Python services (ai-engine, ingestion) expose `/health` only (no
dependency checks yet); apps/web has no health route, so Helm uses TCP probes.

### Graceful shutdown
On SIGTERM: readiness → 503, wait `SHUTDOWN_DRAIN_DELAY_MS` (5s) so the
endpoint controller stops routing, `server.close()` drains in-flight requests,
then pools/Redis/BullMQ workers close. Forced exit after `SHUTDOWN_TIMEOUT_MS`
(25s, under the Kubernetes 30s grace period).

---

## 5. Backup and restore

| Target | Value | How |
|---|---|---|
| RPO (node/zone loss) | ~0 | CNPG synchronous replication to ≥1 replica in another zone |
| RPO (cluster/region loss) | ≤ 5 min | Continuous WAL archiving to S3 (`archive_timeout = 5min`) |
| RTO (node/zone loss) | < 2 min | CNPG automatic failover |
| RTO (full restore) | < 4 h | New CNPG cluster bootstrapped from the barman backup + WAL replay |
| Retention | 30 days PITR | `retentionPolicy: 30d`, nightly base backup |

Restore drill (do this **quarterly** — an untested backup isn't a backup):

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: nexcrm-pg-restore }
spec:
  instances: 1
  imageName: ghcr.io/kennypy/crm/postgres-age:16-1.6.0
  postgresql: { shared_preload_libraries: ["age"] }
  storage: { size: 100Gi }
  bootstrap:
    recovery:
      source: nexcrm-pg
      recoveryTarget: { targetTime: "2026-11-11 09:00:00+00" }   # PITR point
  externalClusters:
    - name: nexcrm-pg
      barmanObjectStore:
        destinationPath: s3://nexcrm-pg-backups/prod
        s3Credentials:
          accessKeyId: { name: nexcrm-pg-backup-s3, key: ACCESS_KEY_ID }
          secretAccessKey: { name: nexcrm-pg-backup-s3, key: ACCESS_SECRET_KEY }
```

Verify after restore: `SELECT count(*) FROM tenants;`,
`SELECT * FROM ag_catalog.ag_graph;` (the `nexcrm_graph` graph must exist),
and a Cypher count of `Deal` vertices for one tenant.

Redis is not backed up for recovery purposes — it holds no system-of-record
data. MinIO/S3 file storage: enable bucket versioning + cross-region
replication on the provider side.

---

## 6. Deploy and rollback

Chart: `infra/helm/nexcrm`. Images: `ghcr.io/<repo>/<service>:sha-<git sha>`
(built by `.github/workflows/deploy.yml`).

```bash
# Secrets are created out-of-band (External Secrets / sealed-secrets).
helm upgrade --install nexcrm infra/helm/nexcrm \
  --namespace nexcrm --create-namespace \
  --set global.imageTag=sha-abc1234 \
  --set ingress.hosts.web=app.example.com --set ingress.hosts.api=api.example.com \
  --wait --timeout 10m
```

- Rolling update with `maxUnavailable: 0`, `maxSurge: 1`; a pod only takes
  traffic after `/health/ready` passes, and old pods drain gracefully. Zero
  downtime for stateless changes.
- **Migrations**: apply *before* rolling the app, and keep them
  backward-compatible with the previous release (expand → deploy → contract).
  A migration that locks a hot table (`ALTER TABLE ... ADD COLUMN ... DEFAULT`
  on large tables in old PG versions, `CREATE INDEX` without `CONCURRENTLY`)
  can spend the monthly budget by itself.
- **Rollback**: `helm rollback nexcrm <revision> --wait`. Schema rollbacks are
  manual; that's why migrations must be backward-compatible.
- Background workers run in `nexcrm-gateway-worker` (`RUN_WORKERS=true`);
  API replicas run with `RUN_WORKERS=false`. The workflow engine and the
  scheduled-reports poller hold a Redis leader lock, so 2 worker replicas
  are safe; BullMQ queues hand each job to one consumer.

---

## 7. Sizing for 120 users

Assumes ~120 named users, ~80 concurrent at peak, ~20 req/s peak at the
gateway (UI + integrations), 500k–2M activities, 20–50k deals.

| Component | Replicas | Requests per pod | Notes |
|---|---|---|---|
| api-gateway | 2–6 (HPA 70% CPU) | 250m / 384Mi | |
| gateway-worker | 2 | 100m / 256Mi | leader-locked pollers + BullMQ |
| auth | 2–4 | 100m / 256Mi | |
| graph-core | 2–6 | 250m / 384Mi | AGE query cost dominates |
| outreach | 2–4 | 100m / 256Mi | |
| ai-engine / ai-worker | 2 / 2 | 250m / 512Mi | LLM-bound, not CPU-bound |
| ingestion / ingestion-worker | 2 / 2 | 100m / 256Mi | |
| web | 2–6 | 200m / 384Mi | |
| Postgres (CNPG) | 3 | 2 vCPU / 8 GiB, 100 GiB SSD | 1 primary + 2 replicas across zones |
| Redis | primary + replica | 1 GiB | managed, Multi-AZ |
| Kubernetes nodes | 3 (one per zone) | 4 vCPU / 16 GiB each | |

At this size the application tier is idle most of the time; the 2-replica
minimum is for availability, not load. Re-check with the k6 suites in
`tests/load/` against a production-sized dataset before go-live.

---

## 8. What code cannot guarantee

Be honest with the customer about where the 99% comes from:

1. **The SLO is an operational outcome, not a code property.** The repo now
   provides probes, graceful shutdown, multi-replica manifests, alerting and
   runbooks. The 99% depends on running them: a multi-zone cluster, an
   HA Postgres with tested restores, a managed Redis, and someone answering
   pages.
2. **The current documented deployment target (single self-hosted LXC via
   docker-compose) cannot meet 99% reliably.** One host is one failure
   domain: a kernel update, disk failure or host reboot spends the budget.
   7h18m/month sounds generous until a single disk failure + restore takes 6h.
3. **Postgres is the single most critical dependency and Apache AGE narrows
   your hosting options.** AWS RDS / Aurora and GCP Cloud SQL do not offer
   AGE. Options are CloudNativePG (self-operated, you own failover and
   backups) or Azure Database for PostgreSQL Flexible Server (supports AGE,
   zone-redundant HA). Choose before go-live.
4. **No load test has been run at 120-user data volumes in this repo's CI.**
   The k6 scripts exist; run them against production-sized data before
   committing to latency targets.
5. **Third-party dependencies** (LLM provider, Google/Microsoft APIs, Twilio,
   Stripe) have their own SLAs. They are outside the SLO but they will
   generate support tickets.
6. **Deploys and migrations** are the most common cause of outages. The
   chart makes stateless rollouts zero-downtime; it cannot make a locking
   migration safe.
