"""
Shared OAuth token helpers for the connectors.

The Gmail and Calendar connectors refresh the SAME oauth_tokens row (provider
'google') against the same token endpoint; previously each carried its own copy
of the refresh + mark-error logic (and Outlook a third variant). This module is
the single implementation for the Google pair plus the provider-generic pieces.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import asyncpg
import httpx
import structlog

from ..config import settings

log = structlog.get_logger()

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
TOKEN_REFRESH_BUFFER = 300  # seconds before expiry to refresh proactively


async def mark_integration_error(
    db: asyncpg.Pool, tenant_id: str, user_id: str, provider: str, reason: str
) -> None:
    try:
        await db.execute(
            """UPDATE integrations
               SET status = 'error', error_message = $1, updated_at = NOW()
               WHERE tenant_id = $2 AND user_id = $3 AND provider = $4""",
            reason[:500], tenant_id, user_id, provider,
        )
    except Exception:
        pass


async def get_valid_google_token(
    db: asyncpg.Pool, tenant_id: str, user_id: str
) -> str | None:
    """Return a valid Google access token for this user, refreshing proactively
    if it expires within TOKEN_REFRESH_BUFFER. None if no token exists."""
    row = await db.fetchrow(
        """SELECT access_token, refresh_token, expires_at
           FROM oauth_tokens
           WHERE tenant_id = $1 AND user_id = $2 AND provider = 'google'""",
        tenant_id, user_id,
    )
    if not row:
        log.warning("google_oauth.no_token", tenant_id=tenant_id, user_id=user_id)
        return None

    expires_at = row["expires_at"]
    if expires_at:
        remaining = (
            expires_at.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
        ).total_seconds()
        if remaining >= TOKEN_REFRESH_BUFFER:
            return row["access_token"]

    return await refresh_google_token(db, tenant_id, user_id, row["refresh_token"])


async def refresh_google_token(
    db: asyncpg.Pool, tenant_id: str, user_id: str, refresh_token: str | None
) -> str | None:
    if not refresh_token:
        log.error("google_oauth.no_refresh_token", tenant_id=tenant_id, user_id=user_id)
        await mark_integration_error(db, tenant_id, user_id, "google", "no_refresh_token")
        return None

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "grant_type":    "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id":     settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                },
            )
        resp.raise_for_status()
        data = resp.json()

        new_access_token = data["access_token"]
        expires_in = data.get("expires_in", 3600)
        new_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        await db.execute(
            """UPDATE oauth_tokens
               SET access_token = $1, expires_at = $2, updated_at = NOW()
               WHERE tenant_id = $3 AND user_id = $4 AND provider = 'google'""",
            new_access_token, new_expiry, tenant_id, user_id,
        )
        log.info("google_oauth.token_refreshed", tenant_id=tenant_id, user_id=user_id)
        return new_access_token

    except Exception as exc:
        log.error("google_oauth.refresh_failed", error=str(exc), tenant_id=tenant_id)
        await mark_integration_error(db, tenant_id, user_id, "google", str(exc))
        return None
