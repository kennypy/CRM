"""
Gmail ingestion router.
Handles Google Pub/Sub push notifications for Gmail watch.
"""

import json
import base64
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import redis.asyncio as aioredis

from ..config import settings
from ..models import RawSignalEvent

router = APIRouter()
log = structlog.get_logger()


class PubSubMessage(BaseModel):
    message: dict
    subscription: str


@router.post("/push")
async def gmail_push_notification(body: PubSubMessage):
    """Receive Gmail Pub/Sub push notification."""
    try:
        # Decode the Pub/Sub message
        data = json.loads(base64.b64decode(body.message.get("data", "")).decode())
        email_address = data.get("emailAddress")
        history_id = data.get("historyId")

        log.info("gmail.push_received", email=email_address, history_id=history_id)

        # TODO: fetch changed messages from Gmail API using history_id
        # Then publish raw messages to Redis Stream
        redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

        raw_event = RawSignalEvent(
            tenant_id="TODO-resolve-from-email",
            user_id="TODO-resolve-from-email",
            source="gmail",
            source_event_id=str(history_id),
            raw_payload=data,
        )

        await redis.xadd(
            settings.STREAM_RAW_SIGNALS,
            {"data": raw_event.model_dump_json()},
        )

        return {"status": "ok"}

    except Exception as e:
        log.error("gmail.push_error", error=str(e))
        raise HTTPException(status_code=500, detail="Processing failed")
