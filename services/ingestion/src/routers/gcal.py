"""
Google Calendar Push Notification Router
==========================================
Receives push notifications from Google Calendar watch channels.

Flow:
  POST /gcal/notifications
    ↓ Verify X-Goog-Channel-Token against the stored per-channel secret
    ↓ Look up which user owns this channel (from the verified channel row)
    ↓ GCalConnector.fetch_new_events()
    ↓ Publish each event as RawSignalEvent to nexcrm:raw-signals stream
"""

import hmac
import structlog
from fastapi import APIRouter, Request, Response, BackgroundTasks
import redis.asyncio as aioredis

from ..config import settings
from ..models import RawSignalEvent

log = structlog.get_logger()
router = APIRouter()


async def _process_notification(
    tenant_id: str,
    user_id: str,
    calendar_id: str,
) -> None:
    """Background task: fetch new events and publish to raw-signals."""
    # Import here to avoid circular imports and to allow lazy DB init
    import asyncpg
    from ..connectors.gcal import GCalConnector

    try:
        db = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=2)
        redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        connector = GCalConnector(db)

        events = await connector.fetch_new_events(tenant_id, user_id, calendar_id)

        for event in events:
            raw = RawSignalEvent(
                tenant_id=tenant_id,
                user_id=user_id,
                source="gcal",
                source_event_id=event["id"],
                raw_payload=event,
            )
            await redis.xadd(
                settings.STREAM_RAW_SIGNALS,
                {"data": raw.model_dump_json()},
            )

        log.info(
            "gcal.notifications_processed",
            tenant_id=tenant_id,
            event_count=len(events),
        )

        await db.close()
        await redis.aclose()

    except Exception as exc:
        log.error("gcal.notification_processing_failed", error=str(exc))


@router.post("/notifications")
async def gcal_notifications(request: Request, background_tasks: BackgroundTasks):
    """
    Handle Google Calendar push notification.
    Google sends a POST with headers identifying the channel and resource state.
    We respond immediately (202) and process in the background.
    """
    resource_state  = request.headers.get("X-Goog-Resource-State", "")
    channel_id      = request.headers.get("X-Goog-Channel-ID", "")
    channel_token   = request.headers.get("X-Goog-Channel-Token", "")

    # Sync message — calendar is ready; no events to fetch yet
    if resource_state == "sync":
        log.info("gcal.channel_synced", channel_id=channel_id)
        return Response(status_code=200)

    if resource_state != "exists":
        return Response(status_code=200)

    # Look up which tenant/user owns this channel. The X-Goog-Channel-ID header
    # is attacker-controllable and must NOT be trusted on its own; we verify the
    # X-Goog-Channel-Token against the per-channel secret stored at watch-setup
    # time (constant-time) and resolve tenant/user from that row (C2).
    import asyncpg
    try:
        db = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=2)
        row = await db.fetchrow(
            """
            SELECT tenant_id, user_id,
                   metadata->>'gcal_calendar_id' AS calendar_id,
                   metadata->>'gcal_channel_token' AS channel_token
            FROM oauth_tokens
            WHERE provider = 'google'
              AND metadata->>'gcal_channel_id' = $1
            """,
            channel_id,
        )
        await db.close()
    except Exception as exc:
        log.error("gcal.channel_lookup_failed", error=str(exc))
        return Response(status_code=200)

    if not row:
        log.warning("gcal.unknown_channel", channel_id=channel_id)
        return Response(status_code=401)

    stored_token = row["channel_token"]
    if not stored_token:
        # No secret stored for this channel — cannot prove authenticity.
        log.warning("gcal.no_channel_token", channel_id=channel_id)
        return Response(status_code=401)

    if not channel_token or not hmac.compare_digest(channel_token, stored_token):
        log.warning("gcal.channel_token_mismatch", channel_id=channel_id)
        return Response(status_code=401)

    background_tasks.add_task(
        _process_notification,
        tenant_id=str(row["tenant_id"]),
        user_id=str(row["user_id"]),
        calendar_id=row["calendar_id"] or "primary",
    )

    return Response(status_code=202)
