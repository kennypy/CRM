"""
Live integration test: the ingestion pipeline (normalize -> resolve -> persist)
against real PostgreSQL + Redis. Proves the "zero-entry" claim end to end — a raw
Gmail payload becomes a crm_events row linked to the resolved contact — plus the
review-queue and crm-writes persisters.

Run via tests/integration/run.sh. Requires DATABASE_URL + REDIS_URL in the env.
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
    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    redis = aioredis.from_url(os.environ["REDIS_URL"], decode_responses=True)
    await redis.flushall()
    tenant = str(uuid.uuid4())
    await pool.execute("INSERT INTO tenants (id,name) VALUES ($1::uuid,'pipeline')", tenant)

    from src.workers.normalizer import normalize_gmail
    from src.workers.entity_resolver import EntityResolver
    from src.workers.crm_writer import persist_activity, persist_review_item, apply_crm_write

    raw = {"id": "msg-123", "threadId": "t-9", "internalDate": "1751000000000",
           "payload": {"headers": [
               {"name": "From", "value": "Jane Buyer <jane@acmecorp.com>"},
               {"name": "To", "value": "rep@ourco.com"},
               {"name": "Subject", "value": "Re: pricing"}],
               "mimeType": "text/plain", "body": {}}}
    activity = normalize_gmail(raw, tenant, str(uuid.uuid4()))
    check("normalize_gmail extracts sender", activity.from_email == "jane@acmecorp.com")
    check("normalize_gmail sets subject", activity.subject == "Re: pricing")

    contact_node = str(uuid.uuid4())
    await pool.execute("INSERT INTO person_email_index (tenant_id,email,node_id) VALUES ($1::uuid,$2,$3)",
                       tenant, "jane@acmecorp.com", contact_node)
    enriched = await EntityResolver(pool, redis).resolve_activity(json.loads(activity.model_dump_json()))
    check("resolver matched existing contact",
          enriched["resolved_persons"]["jane@acmecorp.com"]["node_id"] == contact_node)

    await persist_activity(pool, enriched)
    row = await pool.fetchrow("SELECT entity_type, entity_id::text AS eid FROM crm_events "
        "WHERE tenant_id=$1::uuid AND event_type LIKE 'activity.%' ORDER BY created_at DESC LIMIT 1", tenant)
    check("email persisted to crm_events", row is not None)
    check("activity linked to resolved contact",
          row and row["eid"] == contact_node and row["entity_type"] == "contact")

    await persist_review_item(pool, {"tenant_id": tenant, "extraction_id": "msg-123", "confidence": 0.82,
        "summary": "Proposed title=VP", "proposed_changes": json.dumps({"title": "VP"}), "evidence": "..."})
    rq = await pool.fetchrow("SELECT confidence FROM review_queue "
        "WHERE tenant_id=$1::uuid AND extraction_id=$2", tenant, "msg-123")
    check("extraction review persisted to review_queue", rq is not None and float(rq["confidence"]) == 0.82)

    new_person = str(uuid.uuid4())
    await apply_crm_write(pool, {"operation": "create_node", "label": "Person", "tenant_id": tenant,
        "properties": {"id": new_person, "email": "new@acmecorp.com", "first_name": "New"}})
    ec = await pool.fetchrow("SELECT entity_id::text AS eid FROM crm_events "
        "WHERE tenant_id=$1::uuid AND event_type='entity.created'", tenant)
    check("create_node wrote entity.created", ec is not None and ec["eid"] == new_person)

    print(f"\n==== pipeline: {len(PASS)} passed, {len(FAIL)} failed ====")
    await pool.close(); await redis.aclose()
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    asyncio.run(main())
