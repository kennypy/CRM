"""
Extraction Worker
=================
Reads ActivityEvents from nexcrm:normalized-signals.
Uses Claude (Haiku for speed) to extract structured CRM data.
Routes results based on confidence:
  >= AUTO_APPROVE_THRESHOLD  → nexcrm:crm-writes (auto-write)
  >= CONFIDENCE_THRESHOLD    → nexcrm:review-queue (human review)
  < CONFIDENCE_THRESHOLD     → discard + audit log
"""

import json
import asyncio
from typing import Any

import anthropic
import redis.asyncio as aioredis
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from ..config import settings
from ..prompts.extraction import EXTRACTION_SYSTEM_PROMPT, build_extraction_prompt

log = structlog.get_logger()
client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)


async def start_extraction_worker():
    redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    consumer_group = "extractor"
    stream = settings.STREAM_NORMALIZED

    try:
        await redis.xgroup_create(stream, consumer_group, id="0", mkstream=True)
    except Exception:
        pass

    log.info("extraction_worker.started", stream=stream)

    while True:
        try:
            messages = await redis.xreadgroup(
                groupname=consumer_group,
                consumername="extractor-1",
                streams={stream: ">"},
                count=5,
                block=2000,
            )

            for _, stream_messages in (messages or []):
                tasks = [
                    _process_activity(redis, msg_id, fields)
                    for msg_id, fields in stream_messages
                ]
                await asyncio.gather(*tasks, return_exceptions=True)

        except Exception as e:
            log.error("extraction_worker.error", error=str(e))
            await asyncio.sleep(5)


async def _process_activity(redis, msg_id: str, fields: dict):
    try:
        activity = json.loads(fields["data"])
        body = activity.get("body_text") or ""

        if len(body.strip()) < 10:
            # Too short to extract anything meaningful
            await redis.xack(settings.STREAM_NORMALIZED, "extractor", msg_id)
            return

        result = await _extract_with_llm(
            activity_type=activity.get("activity_type", "email"),
            subject=activity.get("subject"),
            body=body,
        )

        if not result:
            await redis.xack(settings.STREAM_NORMALIZED, "extractor", msg_id)
            return

        overall_confidence = _compute_overall_confidence(result)

        extraction_record = {
            "activity_id": activity.get("id"),
            "tenant_id": activity.get("tenant_id"),
            "source": activity.get("source"),
            "confidence": overall_confidence,
            "extraction": result,
            "activity_type": activity.get("activity_type"),
        }

        if overall_confidence >= settings.AI_AUTO_APPROVE_THRESHOLD:
            await redis.xadd(settings.STREAM_CRM_WRITES, {"data": json.dumps(extraction_record)})
            log.info("extraction.auto_write", confidence=overall_confidence, activity_id=activity.get("id"))

        elif overall_confidence >= settings.AI_CONFIDENCE_THRESHOLD:
            review_item = {
                "tenant_id": activity.get("tenant_id"),
                "extraction_id": activity.get("id"),
                "confidence": overall_confidence,
                "summary": _build_review_summary(result),
                "proposed_changes": json.dumps(_build_proposed_changes(result)),
                "evidence": body[:500],
            }
            await redis.xadd(settings.STREAM_REVIEW_QUEUE, {"data": json.dumps(review_item)})
            log.info("extraction.review_queue", confidence=overall_confidence, activity_id=activity.get("id"))

        else:
            log.info("extraction.discarded", confidence=overall_confidence, activity_id=activity.get("id"))

        await redis.xack(settings.STREAM_NORMALIZED, "extractor", msg_id)

    except Exception as e:
        log.error("extraction.processing_failed", msg_id=msg_id, error=str(e))


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, min=2, max=10))
async def _extract_with_llm(
    activity_type: str,
    subject: str | None,
    body: str,
) -> dict[str, Any] | None:
    """Call Claude Haiku for structured extraction. Retries once on failure."""
    try:
        prompt = build_extraction_prompt(activity_type, subject, body)

        response = await client.messages.create(
            model=settings.AI_FAST_MODEL,
            max_tokens=2048,
            system=EXTRACTION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        content = response.content[0].text.strip()

        # Parse JSON — if invalid, return None rather than crash
        return json.loads(content)

    except json.JSONDecodeError as e:
        log.warning("extraction.invalid_json", error=str(e))
        return None
    except anthropic.APIError as e:
        log.error("extraction.api_error", error=str(e))
        raise  # trigger retry


def _compute_overall_confidence(result: dict) -> float:
    """Compute aggregate confidence from all extracted entities and signals."""
    confidences = []

    for entity in result.get("entities", []):
        for field_data in entity.get("fields", {}).values():
            if isinstance(field_data, dict) and "confidence" in field_data:
                confidences.append(field_data["confidence"])

    for signal in result.get("signals", []):
        confidences.append(signal.get("confidence", 0.5))

    return sum(confidences) / len(confidences) if confidences else 0.0


def _build_review_summary(result: dict) -> str:
    parts = []

    entities = result.get("entities", [])
    if entities:
        types = [e.get("type", "unknown") for e in entities]
        parts.append(f"Extracted {len(entities)} entities: {', '.join(types)}")

    signals = result.get("signals", [])
    if signals:
        types = [s.get("type", "unknown") for s in signals]
        parts.append(f"Signals: {', '.join(types)}")

    return ". ".join(parts) if parts else "Unstructured extraction"


def _build_proposed_changes(result: dict) -> list[dict]:
    changes = []
    for i, entity in enumerate(result.get("entities", [])):
        for field_name, field_data in entity.get("fields", {}).items():
            if isinstance(field_data, dict):
                changes.append({
                    "operation": "create_or_update",
                    "entity_type": entity.get("type"),
                    "entity_idx": i,
                    "field": field_name,
                    "proposed_value": field_data.get("value"),
                    "confidence": field_data.get("confidence"),
                    "evidence": field_data.get("evidence"),
                })
    return changes
