"""
Live integration test: anomaly detector (services/ai-engine/src/routers/anomalies.py)
against a real PostgreSQL. Seeds crm_events and asserts the detector writes the
right anomaly_alerts rows and is idempotent.

Run via tests/integration/run.sh (which provisions Postgres + the schema and sets
DATABASE_URL). Requires: pip install asyncpg fastapi pydantic pydantic-settings structlog httpx
"""
import os, asyncio, uuid, json, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/ai-engine"))
import asyncpg

PASS, FAIL = [], []
def check(name, cond):
    (PASS if cond else FAIL).append(name)
    print(("PASS " if cond else "FAIL ") + name)


async def seed_event(pool, tenant, entity_type, entity_id, etype, days_ago, stage=None):
    payload = {"stage": stage, "name": f"Deal {entity_id[:4]}", "value": 1000} if stage else {}
    await pool.execute(
        "INSERT INTO crm_events (tenant_id,event_type,source,entity_type,entity_id,payload,created_at) "
        "VALUES ($1::uuid,$2,'test',$3,$4::uuid,$5::jsonb, NOW() - ($6||' days')::interval)",
        tenant, etype, entity_type, entity_id, json.dumps(payload), str(days_ago))


async def main():
    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    import src.db as aidb
    from src.routers import anomalies as anom
    aidb._pool = pool  # point the router's get_pool() at our test pool

    tenant = str(uuid.uuid4())
    await pool.execute("INSERT INTO tenants (id,name) VALUES ($1::uuid,'anom')", tenant)

    stalled, ghost, healthy, dark = (str(uuid.uuid4()) for _ in range(4))
    await seed_event(pool, tenant, "deal", stalled, "deal.created", 40)
    await seed_event(pool, tenant, "deal", stalled, "deal.stage_changed", 20, "negotiation")
    await seed_event(pool, tenant, "deal", ghost, "deal.created", 25)
    await seed_event(pool, tenant, "deal", healthy, "deal.created", 30)
    await seed_event(pool, tenant, "deal", healthy, "deal.stage_changed", 2, "negotiation")
    await seed_event(pool, tenant, "company", dark, "activity.email", 40)

    r = await anom.scan(tenant_id=tenant)
    check("scan returns success", r.get("success") is True)
    check("scan created >=3 alerts", r["data"]["alerts_created"] >= 3)
    rows = await pool.fetch("SELECT alert_type, entity_id FROM anomaly_alerts WHERE tenant_id=$1::uuid", tenant)
    types = {row["alert_type"] for row in rows}
    check("stalled_deal detected", "stalled_deal" in types)
    check("ghost_deal detected", "ghost_deal" in types)
    check("at_risk_account detected", "at_risk_account" in types)
    check("healthy deal NOT flagged", all(row["entity_id"] != healthy for row in rows))

    r2 = await anom.scan(tenant_id=tenant)
    check("rescan is idempotent (0 new)", r2["data"]["alerts_created"] == 0)
    total = await pool.fetchval("SELECT COUNT(*) FROM anomaly_alerts WHERE tenant_id=$1::uuid", tenant)
    check("no duplicate alerts after rescan", total == r["data"]["alerts_created"])

    print(f"\n==== anomaly: {len(PASS)} passed, {len(FAIL)} failed ====")
    await pool.close()
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    asyncio.run(main())
