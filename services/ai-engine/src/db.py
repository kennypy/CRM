"""
Async database pool for the AI engine.
Used by the scoring router for direct Postgres queries.
"""

import asyncpg
import structlog
from .config import settings

log = structlog.get_logger()

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings.DATABASE_URL,
            min_size=1,
            max_size=5,
            command_timeout=10,
        )
        log.info("ai_engine.db_pool.ready")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
