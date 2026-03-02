"""
Normalizer Worker
=================
Reads from nexcrm:raw-signals Redis Stream.
Converts raw source payloads to canonical ActivityEvent.
Publishes to nexcrm:normalized-signals.
"""

import json
from datetime import datetime
from typing import Any

import redis.asyncio as aioredis
import structlog

from ..config import settings
from ..models import ActivityEvent, RawSignalEvent

log = structlog.get_logger()


def normalize_gmail(raw: dict[str, Any], tenant_id: str, user_id: str) -> ActivityEvent:
    """Convert Gmail API message payload to ActivityEvent."""
    headers = {h["name"].lower(): h["value"] for h in raw.get("payload", {}).get("headers", [])}

    # Extract plain-text body
    body_text = _extract_gmail_body(raw.get("payload", {}))

    return ActivityEvent(
        tenant_id=tenant_id,
        user_id=user_id,
        source="gmail",
        source_event_id=raw["id"],
        activity_type="email",
        from_email=_parse_email(headers.get("from", "")),
        from_name=_parse_name(headers.get("from", "")),
        to_emails=[_parse_email(e) for e in headers.get("to", "").split(",") if e.strip()],
        cc_emails=[_parse_email(e) for e in headers.get("cc", "").split(",") if e.strip()],
        subject=headers.get("subject"),
        body_text=body_text,
        thread_id=raw.get("threadId"),
        occurred_at=datetime.utcfromtimestamp(int(raw.get("internalDate", 0)) / 1000),
    )


def normalize_gcal(raw: dict[str, Any], tenant_id: str, user_id: str) -> ActivityEvent:
    """Convert Google Calendar event payload to ActivityEvent."""
    attendees = raw.get("attendees", [])
    participant_emails = [a["email"] for a in attendees if "email" in a]

    start = raw.get("start", {})
    occurred_at_str = start.get("dateTime") or start.get("date")
    occurred_at = datetime.fromisoformat(occurred_at_str.replace("Z", "+00:00")) if occurred_at_str else datetime.utcnow()

    return ActivityEvent(
        tenant_id=tenant_id,
        user_id=user_id,
        source="gcal",
        source_event_id=raw["id"],
        activity_type="meeting",
        subject=raw.get("summary"),
        body_text=raw.get("description"),
        participant_emails=participant_emails,
        meeting_url=raw.get("hangoutLink"),
        occurred_at=occurred_at,
    )


def normalize_zoom_transcript(raw: dict[str, Any], tenant_id: str, user_id: str) -> ActivityEvent:
    """Convert Zoom webhook transcript payload to ActivityEvent."""
    return ActivityEvent(
        tenant_id=tenant_id,
        user_id=user_id,
        source="zoom",
        source_event_id=raw.get("payload", {}).get("object", {}).get("uuid", ""),
        activity_type="meeting",
        subject=raw.get("payload", {}).get("object", {}).get("topic"),
        body_text=raw.get("payload", {}).get("object", {}).get("transcript_content"),
        duration_seconds=raw.get("payload", {}).get("object", {}).get("duration", 0) * 60,
        recording_url=raw.get("payload", {}).get("object", {}).get("recording_files", [{}])[0].get("play_url"),
        occurred_at=datetime.utcnow(),
    )


NORMALIZERS = {
    "gmail": normalize_gmail,
    "gcal": normalize_gcal,
    "zoom": normalize_zoom_transcript,
}


async def start_normalizer_workers():
    """Redis Streams consumer loop for the normalizer."""
    redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    consumer_group = "normalizer"
    stream = settings.STREAM_RAW_SIGNALS

    # Create consumer group (idempotent)
    try:
        await redis.xgroup_create(stream, consumer_group, id="0", mkstream=True)
    except Exception:
        pass  # Group already exists

    log.info("normalizer_worker.started", stream=stream)

    while True:
        try:
            messages = await redis.xreadgroup(
                groupname=consumer_group,
                consumername="normalizer-1",
                streams={stream: ">"},
                count=10,
                block=1000,
            )

            for stream_name, stream_messages in (messages or []):
                for msg_id, fields in stream_messages:
                    await _process_raw_signal(redis, msg_id, fields)

        except Exception as e:
            log.error("normalizer_worker.error", error=str(e))


async def _process_raw_signal(redis, msg_id: str, fields: dict):
    try:
        raw_event = RawSignalEvent(**json.loads(fields["data"]))
        normalizer = NORMALIZERS.get(raw_event.source)

        if not normalizer:
            log.warning("normalizer.unknown_source", source=raw_event.source)
            await redis.xack(settings.STREAM_RAW_SIGNALS, "normalizer", msg_id)
            return

        activity = normalizer(raw_event.raw_payload, raw_event.tenant_id, raw_event.user_id)

        await redis.xadd(
            settings.STREAM_NORMALIZED,
            {"data": activity.model_dump_json()},
        )
        await redis.xack(settings.STREAM_RAW_SIGNALS, "normalizer", msg_id)

        log.info("normalizer.processed", source=raw_event.source, activity_id=activity.id)

    except Exception as e:
        log.error("normalizer.processing_failed", msg_id=msg_id, error=str(e))


def _parse_email(header_value: str) -> str:
    """Extract email from 'Name <email@domain.com>' format."""
    if "<" in header_value and ">" in header_value:
        return header_value.split("<")[1].rstrip(">").strip()
    return header_value.strip()


def _parse_name(header_value: str) -> str:
    """Extract name from 'Name <email@domain.com>' format."""
    if "<" in header_value:
        return header_value.split("<")[0].strip().strip('"')
    return ""


def _extract_gmail_body(payload: dict) -> str:
    """Recursively extract plain text from Gmail message parts."""
    import base64

    mime_type = payload.get("mimeType", "")

    if mime_type == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")

    for part in payload.get("parts", []):
        result = _extract_gmail_body(part)
        if result:
            return result

    return ""
