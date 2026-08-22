"""
Meeting summary worker — processes Zoom webhook events from Redis Stream.
Extracts transcript text, calls Claude for summary + action items,
and creates an Activity record (type=meeting).
"""

import os
import json
import httpx
import structlog

from nexcrm_shared.event_bus import consume

from ..config import settings
from ..db import get_pool
from ..llm import complete_json

log = structlog.get_logger()

STREAM_KEY = "nexcrm:zoom_events"
GROUP_NAME = "meeting-summary-workers"
CONSUMER_NAME = f"worker-{os.getpid()}"


async def summarize_transcript(transcript: str, participants: list[str]) -> dict:
    """Use Claude to summarize a meeting transcript."""
    if not settings.ANTHROPIC_API_KEY or not transcript:
        return {
            "summary": "Meeting transcript received (AI summarization not configured).",
            "action_items": [],
            "sentiment": "neutral",
        }

    result = await complete_json(
        f"""Summarize this meeting transcript. Return JSON with:
        - summary: 2-3 sentence overview
        - action_items: array of {{assignee, task, due_date}} objects
        - sentiment: "positive", "neutral", or "negative"
        - key_decisions: array of strings

        Participants: {', '.join(participants)}

        Transcript:
        {transcript[:10000]}

        Return ONLY valid JSON.""",
        max_tokens=1000,
    )
    if isinstance(result, dict):
        return result

    return {
        "summary": f"Meeting with {len(participants)} participants.",
        "action_items": [],
        "sentiment": "neutral",
    }


async def process_zoom_event(event_data: dict) -> None:
    """Process a single Zoom webhook event."""
    pool = await get_pool()
    event_type = event_data.get("event", "")

    # We mainly care about recording completed events (which include transcript)
    if event_type not in ("recording.completed", "meeting.ended"):
        return

    payload = event_data.get("payload", {})
    meeting = payload.get("object", {})
    meeting_id = meeting.get("id", "")
    topic = meeting.get("topic", "Untitled Meeting")
    participants = [p.get("user_name", "") for p in meeting.get("participant_list", [])]
    host_email = meeting.get("host_email", "")
    duration = meeting.get("duration", 0)

    # Extract transcript if available
    transcript = ""
    recording_files = payload.get("object", {}).get("recording_files", [])
    for rf in recording_files:
        if rf.get("recording_type") == "audio_transcript":
            transcript = rf.get("transcript_text", "")
            break

    # Find tenant by host email
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            """SELECT u.id AS user_id, u.tenant_id
               FROM users u
               JOIN oauth_tokens ot ON ot.user_id = u.id AND ot.provider = 'zoom'
               WHERE u.email = $1
               LIMIT 1""",
            host_email,
        )

    if not user:
        log.info("meeting_summary.no_user", host_email=host_email)
        return

    tenant_id = str(user["tenant_id"])
    user_id = str(user["user_id"])

    # Summarize
    result = await summarize_transcript(transcript, participants)

    # Create meeting summary record
    async with pool.acquire() as conn:
        summary_row = await conn.fetchrow(
            """INSERT INTO meeting_summaries
                 (tenant_id, source, transcript, summary, action_items, participants,
                  sentiment, status, completed_at)
               VALUES ($1, 'zoom', $2, $3, $4, $5, $6, 'completed', NOW())
               RETURNING id""",
            tenant_id,
            transcript[:50000] if transcript else None,
            result.get("summary", ""),
            json.dumps(result.get("action_items", [])),
            json.dumps([{"name": p} for p in participants]),
            result.get("sentiment", "neutral"),
        )

    # Create Activity record via graph-core
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.GRAPH_CORE_URL}/activities",
                params={"tenantId": tenant_id},
                headers={"x-tenant-id": tenant_id, "x-user-id": user_id},
                json={
                    "type": "meeting",
                    "title": f"Meeting: {topic}",
                    "description": result.get("summary", ""),
                    "metadata": {
                        "zoom_meeting_id": meeting_id,
                        "duration_minutes": duration,
                        "participants": participants,
                        "action_items": result.get("action_items", []),
                        "summary_id": str(summary_row["id"]),
                    },
                },
            )
    except Exception as e:
        log.warning("meeting_summary.activity_create_error", error=str(e))

    log.info(
        "meeting_summary.completed",
        meeting_id=meeting_id,
        tenant_id=tenant_id,
        summary_id=str(summary_row["id"]),
    )


async def start_meeting_summary_worker() -> None:
    """Start the Redis Stream consumer for Zoom events. The gateway publishes
    these with the JSON under a `payload` field (see api-gateway/src/routes/
    webhooks.ts), unlike the pipeline streams which use `data`."""
    await consume(
        settings.REDIS_URL, STREAM_KEY, GROUP_NAME, CONSUMER_NAME,
        process_zoom_event,
        count=5, block=5000, field="payload",
    )
