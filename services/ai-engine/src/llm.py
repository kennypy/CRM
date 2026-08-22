"""
Single shared Anthropic client + one-shot completion helpers.

Previously four call sites hand-rolled httpx POSTs to the Anthropic REST API
(each with its own hardcoded model string and header block) while two others
instantiated their own SDK client. Everything goes through here now; the model
defaults to settings.AI_FAST_MODEL.
"""

import json

import anthropic
import structlog

from .config import settings

log = structlog.get_logger()

client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)


async def complete_text(
    prompt: str,
    *,
    max_tokens: int,
    model: str | None = None,
) -> str | None:
    """One-shot completion returning raw text. Returns None when no API key is
    configured or the request fails — callers fall back to their non-AI path."""
    if not settings.ANTHROPIC_API_KEY:
        return None
    try:
        response = await client.messages.create(
            model=model or settings.AI_FAST_MODEL,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
    except Exception as e:
        log.warning("llm.request_failed", error=str(e))
        return None


async def complete_json(
    prompt: str,
    *,
    max_tokens: int,
    model: str | None = None,
) -> dict | list | None:
    """complete_text + JSON parse; None on any failure."""
    text = await complete_text(prompt, max_tokens=max_tokens, model=model)
    if text is None:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        log.warning("llm.invalid_json", error=str(e))
        return None
