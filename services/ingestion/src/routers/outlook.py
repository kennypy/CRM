"""
Outlook / Microsoft Graph Notification Router
================================================
Handles Microsoft Graph change notification webhooks for Outlook Mail + Calendar.

Flow:
  POST /notifications?validationToken=... — subscription validation handshake
  POST /notifications                     — process change notification payload
    ↓ Verify clientState matches tenant_id
    ↓ For each changed resource: fetch full item from Graph API
    ↓ Publish as RawSignalEvent to nexcrm:raw-signals stream
"""

import structlog
from fastapi import APIRouter, Request, Response, BackgroundTasks

from ..config import settings
from ..models import RawSignalEvent

log = structlog.get_logger()
router = APIRouter()


async def _process_notification(notification: dict) -> None:
    """Background: fetch full resource from Graph and publish to raw-signals."""
    import asyncpg
    import redis.asyncio as aioredis
    from ..connectors.outlook import OutlookConnector

    client_state    = notification.get("clientState", "")   # == tenant_id
    resource        = notification.get("resource", "")
    subscription_id = notification.get("subscriptionId", "")
    tenant_id       = client_state

    try:
        db = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=2)
        redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        connector = OutlookConnector(db)

        # Find the user who owns this subscription
        row = await db.fetchrow(
            """
            SELECT user_id FROM oauth_tokens
            WHERE tenant_id = $1::uuid
              AND provider = 'microsoft'
              AND metadata->>'outlook_subscription_id' = $2
            """,
            tenant_id, subscription_id,
        )
        if not row:
            log.warning("outlook.unknown_subscription", sub_id=subscription_id)
            await db.close()
            await redis.aclose()
            return

        user_id = str(row["user_id"])

        # Determine resource type and fetch full payload
        raw_payload: dict | None = None
        source_event_id: str | None = None
        resource_type: str = "outlook"

        if "/Messages/" in resource or "/messages/" in resource:
            msg_id = resource.rsplit("/", 1)[-1]
            raw_payload = await connector.fetch_message_by_id(tenant_id, user_id, msg_id)
            source_event_id = msg_id
        elif "/Events/" in resource or "/events/" in resource:
            event_id = resource.rsplit("/", 1)[-1]
            raw_payload = await connector.fetch_event_by_id(tenant_id, user_id, event_id)
            source_event_id = event_id
            resource_type = "outlook_cal"
        else:
            log.debug("outlook.unsupported_resource", resource=resource)
            await db.close()
            await redis.aclose()
            return

        if not raw_payload or not source_event_id:
            await db.close()
            await redis.aclose()
            return

        raw = RawSignalEvent(
            tenant_id=tenant_id,
            user_id=user_id,
            source="outlook",
            source_event_id=source_event_id,
            raw_payload={**raw_payload, "_resource_type": resource_type},
        )
        await redis.xadd(settings.STREAM_RAW_SIGNALS, {"data": raw.model_dump_json()})
        log.info("outlook.signal_published", resource_type=resource_type)

        await db.close()
        await redis.aclose()

    except Exception as exc:
        log.error("outlook.process_failed", error=str(exc))


@router.post("/notifications")
async def outlook_notifications(request: Request, background_tasks: BackgroundTasks):
    """
    Microsoft Graph webhook endpoint.
    Validation handshake (Graph sends validationToken) or change notification POST.
    Responds 202 immediately; all processing is async.
    """
    validation_token = request.query_params.get("validationToken")
    if validation_token:
        return Response(content=validation_token, media_type="text/plain", status_code=200)

    try:
        body = await request.json()
    except Exception:
        return Response(status_code=400)

    notifications = body.get("value", [])
    log.info("outlook.notifications_received", count=len(notifications))

    for notif in notifications:
        background_tasks.add_task(_process_notification, notif)

    return Response(status_code=202)
