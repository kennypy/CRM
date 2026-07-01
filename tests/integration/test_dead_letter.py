"""
Live integration test: the crm-writes consumer dead-letters a poison message
(instead of silently dropping it) and does not wedge the consumer group — a valid
message published afterwards is still processed.

Run via tests/integration/run.sh.
"""
import os, asyncio, uuid, json, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/ingestion"))
import asyncpg
import redis.asyncio as aioredis

PASS, FAIL = [], []
def check(name, cond):
    (PASS if cond else FAIL).append(name)
    print(("PASS " if cond else "FAIL ") + name)


async def main():
    from src.workers.crm_writer import start_crm_writer
    from src.config import settings

    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    redis = aioredis.from_url(os.environ["REDIS_URL"], decode_responses=True)
    await redis.delete(settings.STREAM_CRM_WRITES, settings.STREAM_CRM_WRITES + ":dead-letter")
    tenant = str(uuid.uuid4())
    await pool.execute("INSERT INTO tenants (id,name) VALUES ($1::uuid,'dlq')", tenant)

    task = asyncio.create_task(start_crm_writer(pool))
    await asyncio.sleep(0.5)

    # poison: non-uuid id makes the $3::uuid insert throw
    await redis.xadd(settings.STREAM_CRM_WRITES, {"data": json.dumps({
        "operation": "create_node", "label": "Person", "tenant_id": tenant,
        "properties": {"id": "NOT-A-UUID", "email": "x@y.com"}})})
    good = str(uuid.uuid4())
    await redis.xadd(settings.STREAM_CRM_WRITES, {"data": json.dumps({
        "operation": "create_node", "label": "Person", "tenant_id": tenant,
        "properties": {"id": good, "email": "good@y.com"}})})
    await asyncio.sleep(1.5)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    dlq = await redis.xlen(settings.STREAM_CRM_WRITES + ":dead-letter")
    good_written = await pool.fetchval(
        "SELECT COUNT(*) FROM crm_events WHERE tenant_id=$1::uuid AND entity_id=$2::uuid", tenant, good)
    check("poison message dead-lettered", dlq >= 1)
    check("good message still processed (group not wedged)", good_written == 1)

    print(f"\n==== dead-letter: {len(PASS)} passed, {len(FAIL)} failed ====")
    await pool.close(); await redis.aclose()
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    asyncio.run(main())
