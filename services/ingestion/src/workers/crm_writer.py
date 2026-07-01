"""
CRM Writer / Persistence Workers
================================
These consumers are the missing final links in the ingestion pipeline. Prior to
this, resolved activities, node-creations and extraction results were published
to Redis streams that nothing consumed, so "zero-entry capture" persisted zero
records. Each worker below drains one stream into durable Postgres state (and,
for node-creations, into the graph via graph-core).

Pipeline:
  raw-signals -[normalizer]-> normalized-signals -[resolver]-> resolved-signals
                                                                     |
    resolved-signals            -[activity_persister]-> crm_events   (activities)
    crm-writes  (from resolver) -[crm_writer]--------->  graph nodes + crm_events
    review-queue (from extractor)-[review_persister]--> review_queue table
"""

import asyncio
import json
from typing import Any

import asyncpg
import httpx
import redis.asyncio as aioredis
import structlog

from ..config import settings

log = structlog.get_logger()

# Map ingestion node labels to CRM entity_type vocabulary used across the app.
_ENTITY_TYPE = {"Person": "contact", "Company": "company"}


async def _consume(stream: str, group: str, consumer: str, handler, block: int = 2000):
    """Shared Redis Streams consumer loop with a consumer group and per-message ack."""
    redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        await redis.xgroup_create(stream, group, id="0", mkstream=True)
    except Exception:
        pass  # group already exists
    log.info("worker.started", stream=stream, group=group)

    while True:
        try:
            messages = await redis.xreadgroup(
                groupname=group, consumername=consumer,
                streams={stream: ">"}, count=10, block=block,
            )
            for _, stream_messages in (messages or []):
                for msg_id, fields in stream_messages:
                    try:
                        await handler(json.loads(fields["data"]))
                    except Exception as e:
                        # Don't silently drop: park the payload on a dead-letter
                        # stream (durable, inspectable) before acking, so a
                        # transient DB error or a poison message is recoverable
                        # rather than lost. Retrying in-place would wedge the group.
                        log.error("worker.handler_failed", stream=stream, msg_id=msg_id, error=str(e))
                        try:
                            await redis.xadd(
                                f"{stream}:dead-letter",
                                {"data": fields.get("data", ""), "error": str(e), "group": group},
                                maxlen=10000, approximate=True,
                            )
                        except Exception as dlq_err:
                            log.error("worker.dead_letter_failed", stream=stream, error=str(dlq_err))
                    await redis.xack(stream, group, msg_id)
        except Exception as e:
            log.error("worker.loop_error", stream=stream, error=str(e))
            await asyncio.sleep(5)


# ── 1. Activity persister: resolved-signals -> crm_events ─────────────────────

def _primary_entity(activity: dict[str, Any]) -> tuple[str, str]:
    """Pick the entity a captured activity is linked to: prefer the resolved
    sender/person node, then a resolved company, else the activity itself."""
    resolved = activity.get("resolved_persons") or {}
    sender = (activity.get("from_email") or "").lower().strip()
    if sender in resolved and resolved[sender].get("node_id"):
        return "contact", resolved[sender]["node_id"]
    for r in resolved.values():
        if r.get("node_id"):
            return "contact", r["node_id"]
    for r in (activity.get("resolved_companies") or {}).values():
        if r.get("node_id"):
            return "company", r["node_id"]
    # Fall back to the activity's own UUID so the event is always captured.
    return "activity", activity["id"]


async def persist_activity(pool: asyncpg.Pool, activity: dict[str, Any]) -> None:
    """Persist a resolved activity as a crm_events row. Module-level so it can be
    exercised directly (see the integration test) as well as from the worker."""
    entity_type, entity_id = _primary_entity(activity)
    payload = {
        "subject": activity.get("subject"),
        "from_email": activity.get("from_email"),
        "to_emails": activity.get("to_emails"),
        "thread_id": activity.get("thread_id"),
        "activity_id": activity.get("id"),
        "occurred_at": activity.get("occurred_at"),
    }
    await pool.execute(
        """INSERT INTO crm_events
             (tenant_id, event_type, source, actor_id, entity_type, entity_id, payload, metadata)
           VALUES ($1::uuid, $2, $3, NULL, $4, $5::uuid, $6::jsonb, $7::jsonb)""",
        activity["tenant_id"],
        f"activity.{activity.get('activity_type', 'event')}",
        activity.get("source", "ingestion"),
        entity_type,
        entity_id,
        json.dumps(payload),
        json.dumps({"resolved_at": activity.get("resolution_at")}),
    )
    log.info("activity_persisted", activity_id=activity.get("id"), entity_type=entity_type)


async def start_activity_persister(pool: asyncpg.Pool):
    await _consume(
        settings.STREAM_RESOLVED, "activity-persister", "activity-persister-1",
        lambda a: persist_activity(pool, a),
    )


# ── 2. Review persister: review-queue -> review_queue table ───────────────────

async def persist_review_item(pool: asyncpg.Pool, item: dict[str, Any]) -> None:
    proposed = item.get("proposed_changes")
    # The extractor may already have json-encoded proposed_changes; store as jsonb.
    proposed_json = proposed if isinstance(proposed, str) else json.dumps(proposed or {})
    await pool.execute(
        """INSERT INTO review_queue
             (tenant_id, extraction_id, confidence, summary, proposed_changes, evidence)
           VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6)""",
        item["tenant_id"],
        item["extraction_id"],
        float(item.get("confidence", 0.0)),
        item.get("summary", ""),
        proposed_json,
        item.get("evidence"),
    )
    log.info("review_item_persisted", extraction_id=item.get("extraction_id"))


async def start_review_persister(pool: asyncpg.Pool):
    await _consume(
        settings.STREAM_REVIEW_QUEUE, "review-persister", "review-persister-1",
        lambda i: persist_review_item(pool, i),
    )


# ── 3. CRM writer: crm-writes -> graph nodes + crm_events ─────────────────────

async def _create_graph_node(op: dict[str, Any]) -> None:
    """Best-effort create of a Person/Company node in graph-core so ingested
    entities are visible in the graph (contacts/companies pages, traversals)."""
    label = op.get("label")
    props = op.get("properties", {})
    tenant_id = op.get("tenant_id")
    endpoint = {"Person": "/contacts", "Company": "/companies"}.get(label)
    if not endpoint or not tenant_id:
        return
    headers = {"x-tenant-id": tenant_id, "content-type": "application/json"}
    if settings.INTERNAL_SERVICE_SECRET:
        headers["x-service-token"] = settings.INTERNAL_SERVICE_SECRET
    body = (
        {"id": props.get("id"), "email": props.get("email"),
         "firstName": props.get("first_name", ""), "lastName": props.get("last_name", ""),
         "source": "ingestion"}
        if label == "Person"
        else {"id": props.get("id"), "name": props.get("name"),
              "domain": props.get("domain"), "source": "ingestion"}
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.GRAPH_CORE_URL}{endpoint}",
                params={"tenantId": tenant_id}, headers=headers, json=body,
            )
            if resp.status_code >= 400:
                log.warning("crm_writer.graph_create_failed",
                            label=label, status=resp.status_code)
    except Exception as e:
        log.warning("crm_writer.graph_create_error", label=label, error=str(e))


async def apply_crm_write(pool: asyncpg.Pool, op: dict[str, Any]) -> None:
    if op.get("operation") == "create_node":
        props = op.get("properties", {})
        entity_id = props.get("id")
        tenant_id = op.get("tenant_id")
        if not entity_id or not tenant_id:
            return
        await _create_graph_node(op)
        await pool.execute(
            """INSERT INTO crm_events
                 (tenant_id, event_type, source, actor_id, entity_type, entity_id, payload, metadata)
               VALUES ($1::uuid, 'entity.created', 'ingestion', NULL, $2, $3::uuid, $4::jsonb, '{}'::jsonb)""",
            tenant_id,
            _ENTITY_TYPE.get(op.get("label"), "contact"),
            entity_id,
            json.dumps(props),
        )
        log.info("crm_writer.node_created", label=op.get("label"), entity_id=entity_id)
    elif "changes" in op:
        # Auto-write extraction result (rare; gated on trusted source). Record it
        # as an auditable signal event rather than blindly mutating graph state.
        await pool.execute(
            """INSERT INTO crm_events
                 (tenant_id, event_type, source, actor_id, entity_type, entity_id, payload, metadata)
               VALUES ($1::uuid, 'signal.extracted', $2, NULL, 'activity', $3::uuid, $4::jsonb, $5::jsonb)""",
            op["tenant_id"],
            op.get("source", "extraction"),
            op.get("activity_id"),
            json.dumps(op.get("changes", {})),
            json.dumps({"confidence": op.get("confidence")}),
        )
        log.info("crm_writer.extraction_recorded", activity_id=op.get("activity_id"))


async def start_crm_writer(pool: asyncpg.Pool):
    await _consume(
        settings.STREAM_CRM_WRITES, "crm-writer", "crm-writer-1",
        lambda op: apply_crm_write(pool, op),
    )
