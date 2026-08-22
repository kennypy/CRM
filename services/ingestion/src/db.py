"""Async database pool for the ingestion service (thin wrapper over the shared
singleton). Replaces the previous pattern of creating and tearing down a fresh
asyncpg pool inside every webhook request."""

import asyncpg

from nexcrm_shared.db import close_pool, get_pool as _get_pool

from .config import settings

__all__ = ["get_pool", "close_pool"]


async def get_pool(*, min_size: int = 1, max_size: int = 5) -> asyncpg.Pool:
    return await _get_pool(settings.DATABASE_URL, min_size=min_size, max_size=max_size)
