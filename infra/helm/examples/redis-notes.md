# Redis for NexCRM in production

Redis carries: rate-limit counters, the access-token deny-list, idempotency
keys, leader locks, and all BullMQ queues (webhooks, imports, DSR, exports,
sequences). Losing it does not lose CRM data (Postgres is the system of
record) but it does pause queues and can drop in-flight jobs.

Requirements:
- `maxmemory-policy noeviction` — BullMQ breaks if job keys are evicted.
- AOF persistence (`appendonly yes`, `appendfsync everysec`).
- HA with automatic failover. Options, in order of preference:
  1. Managed: AWS ElastiCache (Multi-AZ, cluster mode **disabled**),
     GCP Memorystore Standard tier, Azure Cache for Redis Standard/Premium.
  2. Self-managed: Bitnami `redis` chart with `architecture: replication` and
     `sentinel.enabled: true` (3 nodes across zones).
- BullMQ does not support Redis Cluster mode without hash-tagged queue
  prefixes — use a single primary with replicas.
- ioredis needs the Sentinel form of the URL if you use Sentinel; the current
  `REDIS_URL` single-URL config works with managed endpoints that fail over
  behind a stable DNS name (ElastiCache primary endpoint, Memorystore).
