"""
Extraction Worker
=================
Reads ActivityEvents from nexcrm:normalized-signals.
Uses Claude (Haiku for speed) to extract structured CRM data.

Routing (see C1 security note below):
  - UNTRUSTED source (inbound email/webhook — the normal case): ALWAYS → review queue,
    regardless of confidence. Never auto-write.
  - TRUSTED source AND auto-write enabled AND confidence >= AUTO_APPROVE_THRESHOLD
    → nexcrm:crm-writes (auto-write), constrained to the allowlist below.
  - Otherwise, confidence >= CONFIDENCE_THRESHOLD → nexcrm:review-queue (human review)
  - confidence < CONFIDENCE_THRESHOLD → discard + audit log

SECURITY (C1): the LLM's self-reported `confidence` is attacker-influenceable via
prompt injection in an untrusted email/webhook body. It is therefore treated as a
NON-authoritative hint only and must never, on its own, authorize an unattended
write into the CRM graph. Auto-write is gated on (a) an explicit trusted source and
(b) the AI_ALLOW_AUTO_WRITE config flag (default false), and applied writes are
restricted to a strict entity-type/field allowlist.
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

# C1: strict allowlist of entity types → writable fields. Auto-write only ever
# applies the intersection of what the model returned and this allowlist, so a
# prompt-injected extraction cannot push arbitrary keys into the CRM graph.
# Field names mirror the extraction schema in src/prompts/extraction.py.
AUTO_WRITE_ALLOWLIST: dict[str, frozenset[str]] = {
    "person": frozenset({"first_name", "last_name", "email", "title", "company_name", "phone"}),
    "company": frozenset({"name", "domain", "industry", "headcount_estimate", "location"}),
    "deal_update": frozenset({
        "stage_signal", "budget_confirmed", "timeline_mentioned", "competitors_mentioned",
        "blockers", "decision_makers_mentioned", "next_steps",
    }),
    "task": frozenset({"title", "due_date", "assignee_name", "related_company"}),
}


def _trusted_sources() -> frozenset[str]:
    """Parse AI_TRUSTED_SOURCES (comma-separated) into a normalized set."""
    return frozenset(
        s.strip().lower() for s in (settings.AI_TRUSTED_SOURCES or "").split(",") if s.strip()
    )


def _is_trusted_source(activity: dict) -> bool:
    """
    C1: Decide whether an extraction may take the auto-write fast-path.

    There is no cryptographic trust marker on normalized signals, so we treat the
    `source` field as the trust signal and require it to be explicitly allowlisted.
    Inbound email / webhook sources are NOT in the allowlist by default, so they are
    always treated as untrusted and routed to human review.
    """
    source = str(activity.get("source") or "").strip().lower()
    return bool(source) and source in _trusted_sources()


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

        # C1: model-reported confidence is a non-authoritative hint. The auto-write
        # fast-path is only available for explicitly trusted/internal sources AND
        # when AI_ALLOW_AUTO_WRITE is enabled. Untrusted external content (the normal
        # case here) ALWAYS goes to human review regardless of confidence — this is
        # the prompt-injection containment boundary.
        auto_write_eligible = (
            settings.AI_ALLOW_AUTO_WRITE
            and _is_trusted_source(activity)
            and overall_confidence >= settings.AI_AUTO_APPROVE_THRESHOLD
        )

        if auto_write_eligible:
            # Constrain the applied write to the strict allowlist rather than trusting
            # whatever JSON the model emitted.
            allowlisted = _build_allowlisted_changes(result)
            if not allowlisted:
                # Nothing the model returned is safe to write; fall back to review.
                log.warning(
                    "extraction.auto_write_empty_after_allowlist",
                    activity_id=activity.get("id"),
                )
            else:
                extraction_record = {
                    "activity_id": activity.get("id"),
                    "tenant_id": activity.get("tenant_id"),
                    "source": activity.get("source"),
                    "confidence": overall_confidence,
                    # Only the allowlisted changes are forwarded to the writer.
                    "changes": allowlisted,
                    "activity_type": activity.get("activity_type"),
                }
                await redis.xadd(settings.STREAM_CRM_WRITES, {"data": json.dumps(extraction_record)})
                log.info(
                    "extraction.auto_write",
                    confidence=overall_confidence,
                    activity_id=activity.get("id"),
                    source=activity.get("source"),
                    fields=len(allowlisted),
                )
                await redis.xack(settings.STREAM_NORMALIZED, "extractor", msg_id)
                return

        if overall_confidence >= settings.AI_CONFIDENCE_THRESHOLD:
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


def _build_allowlisted_changes(result: dict) -> list[dict]:
    """
    C1: Build the set of writes for the auto-write fast-path, restricted to the
    AUTO_WRITE_ALLOWLIST. Any entity type or field not on the allowlist is dropped,
    so a prompt-injected extraction cannot introduce arbitrary entities/fields into
    the CRM graph even when the trusted-source + confidence gates are satisfied.
    """
    changes: list[dict] = []
    for i, entity in enumerate(result.get("entities", [])):
        entity_type = entity.get("type")
        allowed_fields = AUTO_WRITE_ALLOWLIST.get(entity_type)
        if not allowed_fields:
            continue  # unknown/disallowed entity type → skip
        for field_name, field_data in entity.get("fields", {}).items():
            if field_name not in allowed_fields:
                continue  # field not on allowlist → skip
            if not isinstance(field_data, dict):
                continue
            changes.append({
                "operation": "create_or_update",
                "entity_type": entity_type,
                "entity_idx": i,
                "field": field_name,
                "value": field_data.get("value"),
                "confidence": field_data.get("confidence"),
                "evidence": field_data.get("evidence"),
            })
    return changes


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
