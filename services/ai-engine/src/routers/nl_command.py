"""
Natural Language Command Router
================================
Receives NL commands from the API Gateway and processes them using Claude.
Returns Server-Sent Events (SSE) for streaming UX.
"""

import json
from typing import AsyncIterator

import anthropic
import structlog
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..config import settings

router = APIRouter()
log = structlog.get_logger()
client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

NL_SYSTEM_PROMPT = """You are NexCRM's intelligent command interface. You help sales reps manage their CRM using natural language.

You can:
1. QUERY: retrieve information from the CRM ("show deals losing momentum")
2. CREATE: create new records ("log that Acme legal is involved")
3. UPDATE: update existing records ("move Acme deal to negotiation")
4. NAVIGATE: direct user to a page ("go to Acme's account page")
5. TASK: create action items ("create follow-up for all dark contacts")

For each command:
- First output a "thinking" step explaining your interpretation
- Then output the result as structured JSON

Output format (one JSON object per line, prefixed with "data: "):
data: {"type": "thinking", "content": "Interpreting as a query for stalling deals..."}
data: {"type": "result", "content": "Found 3 deals losing momentum", "data": {...}}
data: {"type": "action", "content": "Creating task for 4 contacts", "data": {"action": "create_task", ...}}

For actions that modify data, ALWAYS include a confirmation step.
Be concise. Reps are busy."""


class NLRequest(BaseModel):
    command: str
    context: dict | None = None


@router.post("/command")
async def process_nl_command(request: NLRequest):
    async def generate() -> AsyncIterator[str]:
        try:
            async with client.messages.stream(
                model=settings.AI_MODEL,
                max_tokens=1024,
                system=NL_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": f"Command: {request.command}\n\nContext: {json.dumps(request.context or {})}",
                    }
                ],
            ) as stream:
                buffer = ""
                async for text in stream.text_stream:
                    buffer += text
                    # Stream complete lines
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if line.startswith("data: "):
                            yield f"{line}\n\n"

                # Flush remaining buffer
                if buffer.strip():
                    yield f"data: {buffer.strip()}\n\n"

        except anthropic.APIError as e:
            log.error("nl_command.api_error", error=str(e))
            yield f'data: {json.dumps({"type": "error", "content": "AI service temporarily unavailable"})}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
