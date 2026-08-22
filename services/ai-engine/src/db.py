"""Async database pool for the AI engine (thin wrapper over the shared singleton)."""

import asyncpg

from nexcrm_shared.db import close_pool, get_pool as _get_pool

from .config import settings

__all__ = ["get_pool", "close_pool"]


async def get_pool() -> asyncpg.Pool:
    return await _get_pool(settings.DATABASE_URL, min_size=1, max_size=5, command_timeout=10)
