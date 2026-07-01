"""
Ingestion worker entrypoint.

Runs the async pipeline workers that were previously defined but never started
(the old comment claimed "workers are started via Celery separately" — there is
no Celery, and no process started them, so the pipeline never ran). This module
is the process launched by the `ingestion-worker` container:

    python -m src.worker

It opens a shared asyncpg pool and runs every consumer concurrently:
  - normalizer:          raw-signals  -> normalized-signals
  - entity resolver:     normalized   -> resolved-signals (+ crm-writes, review-queue)
  - activity persister:  resolved     -> crm_events
  - crm writer:          crm-writes   -> graph nodes + crm_events
  - review persister:    review-queue -> review_queue table
"""

import asyncio

import asyncpg
import structlog

from .config import settings
from .telemetry import setup_telemetry
from .workers.normalizer import start_normalizer_workers
from .workers.entity_resolver import start_resolver_worker
from .workers.crm_writer import (
    start_activity_persister,
    start_review_persister,
    start_crm_writer,
)

log = structlog.get_logger()


async def main() -> None:
    setup_telemetry()
    pool = await asyncpg.create_pool(settings.DATABASE_URL, min_size=2, max_size=10)
    log.info("ingestion_worker.starting")
    try:
        await asyncio.gather(
            start_normalizer_workers(),
            start_resolver_worker(pool),
            start_activity_persister(pool),
            start_crm_writer(pool),
            start_review_persister(pool),
        )
    finally:
        await pool.close()
        log.info("ingestion_worker.stopped")


if __name__ == "__main__":
    asyncio.run(main())
