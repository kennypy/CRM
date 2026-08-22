"""
Async database pool singleton shared by the Python services.

One pool per process; the DSN and sizing take effect on the first get_pool()
call. Services wrap this in a thin src/db.py that supplies their settings.
"""

import asyncpg
import structlog

log = structlog.get_logger()

_pool: asyncpg.Pool | None = None


async def get_pool(
    dsn: str,
    *,
    min_size: int = 1,
    max_size: int = 5,
    command_timeout: float = 10,
) -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn,
            min_size=min_size,
            max_size=max_size,
            command_timeout=command_timeout,
        )
        log.info("db_pool.ready")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
