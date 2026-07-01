"""
AI-engine worker entrypoint.

Runs the LLM-extraction and meeting-summary consumers that were defined but never
started (the FastAPI app only warmed a DB pool). Launched by the `ai-worker`
container:

    python -m src.worker

  - extraction worker:   normalized-signals -> review-queue / crm-writes
  - meeting summary:      zoom events        -> meeting_summaries + graph activity
"""

import asyncio

import structlog

from .telemetry import setup_telemetry
from .db import get_pool, close_pool
from .workers.extraction_worker import start_extraction_worker
from .workers.meeting_summary import start_meeting_summary_worker

log = structlog.get_logger()


async def main() -> None:
    setup_telemetry()
    await get_pool()  # warm shared DB pool used by the workers
    log.info("ai_engine_worker.starting")
    try:
        await asyncio.gather(
            start_extraction_worker(),
            start_meeting_summary_worker(),
        )
    finally:
        await close_pool()
        log.info("ai_engine_worker.stopped")


if __name__ == "__main__":
    asyncio.run(main())
