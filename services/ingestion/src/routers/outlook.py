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

import hmac

import asyncpg
import structlog
from fastapi import APIRouter, Request, Response, BackgroundTasks

from ..config import settings
from ..models import RawSignalEvent

log = structlog.get_logger()
router = APIRouter()


async def _resolve_subscription(subscription_id: str, client_state: str) -> dict | None:
    """
    Authenticate an inbound Graph notification.

    Resolves the subscription row by its Graph subscriptionId (NOT by any
    request-supplied tenant_id), then verifies the request's clientState against
    the per-subscription secret stored at creation time using a constant-time
    comparison. Returns {tenant_id, user_id} on success, or None if the
    subscription is unknown or the clientState does not match.
    """
    if not subscription_id or not client_state:
        return None

    db = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=2)
    try:
        row = await db.fetchrow(
            """
            SELECT tenant_id, user_id,
                   metadata->>'outlook_client_state_secret' AS client_state_secret
            FROM oauth_tokens
            WHERE provider = 'microsoft'
              AND metadata->>'outlook_subscription_id' = $1
            """,
            subscription_id,
        )
    finally:
        await db.close()

    if not row:
        log.warning("outlook.unknown_subscription", sub_id=subscription_id)
        return None

    stored_secret = row["client_state_secret"]
    if not stored_secret:
        # No secret stored for this subscription — cannot prove authenticity.
        log.warning("outlook.no_client_state_secret", sub_id=subscription_id)
        return None

    if not hmac.compare_digest(client_state, stored_secret):
        log.warning("outlook.client_state_mismatch", sub_id=subscription_id)
        return None

    return {"tenant_id": str(row["tenant_id"]), "user_id": str(row["user_id"])}


async def _process_notification(notification: dict, tenant_id: str, user_id: str) -> None:
    """Background: fetch full resource from Graph and publish to raw-signals.

    tenant_id/user_id are resolved + authenticated by the request handler from the
    stored subscription row — never taken from the request payload.
    """
    import redis.asyncio as aioredis
    from ..connectors.outlook import OutlookConnector

    resource = notification.get("resource", "")

    try:
        db = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=2)
        redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        connector = OutlookConnector(db)

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

    scheduled = 0
    rejected = 0
    for notif in notifications:
        auth = await _resolve_subscription(
            notif.get("subscriptionId", ""),
            notif.get("clientState", ""),
        )
        if not auth:
            rejected += 1
            continue
        background_tasks.add_task(
            _process_notification, notif, auth["tenant_id"], auth["user_id"]
        )
        scheduled += 1

    # If nothing could be authenticated, reject the whole request so the caller
    # (and our logs/alerting) see a hard 401 rather than a silent 202.
    if notifications and scheduled == 0:
        return Response(status_code=401)

    return Response(status_code=202)
