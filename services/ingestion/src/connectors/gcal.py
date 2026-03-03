"""
Google Calendar Connector
==========================
Handles OAuth token management and incremental calendar event sync via
push channels (watch) or polling with nextSyncToken.

Architecture:
  1. setup_watch()     — creates a push notification channel for a calendar
  2. fetch_new_events()— incremental sync using nextSyncToken (stored in
                          oauth_tokens.metadata)
  3. get_valid_token() — refreshes access token proactively (5-min buffer)

Events are returned as raw Google Calendar Event objects; the normalizer
worker converts them to canonical ActivityEvent via normalize_gcal().
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg
import httpx
import structlog

from ..config import settings

log = structlog.get_logger()

GOOGLE_TOKEN_URL   = "https://oauth2.googleapis.com/token"
GCAL_API_BASE      = "https://www.googleapis.com/calendar/v3"
GCAL_WATCH_URL     = f"{GCAL_API_BASE}/calendars/{{calendar_id}}/events/watch"
GCAL_EVENTS_URL    = f"{GCAL_API_BASE}/calendars/{{calendar_id}}/events"
WATCH_EXPIRY_SECS  = 7 * 24 * 3600   # Google max: 1 week
TOKEN_REFRESH_BUFFER = 300            # Refresh 5 minutes before expiry


class GCalConnector:
    """Per-user Google Calendar integration."""

    def __init__(self, db_pool: asyncpg.Pool):
        self.db = db_pool

    # ── Token management ──────────────────────────────────────────────────────

    async def get_valid_token(self, tenant_id: str, user_id: str) -> str | None:
        """Return a valid access token, refreshing proactively if needed."""
        row = await self.db.fetchrow(
            """
            SELECT access_token, refresh_token, expires_at, metadata
            FROM oauth_tokens
            WHERE tenant_id = $1 AND user_id = $2 AND provider = 'google'
            """,
            tenant_id, user_id,
        )
        if not row:
            log.warning("gcal.no_token", tenant_id=tenant_id, user_id=user_id)
            return None

        expires_at = row["expires_at"]
        if expires_at:
            remaining = (expires_at.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).total_seconds()
            if remaining < TOKEN_REFRESH_BUFFER:
                return await self._refresh_token(tenant_id, user_id, row["refresh_token"])

        return row["access_token"]

    async def _refresh_token(
        self, tenant_id: str, user_id: str, refresh_token: str | None
    ) -> str | None:
        if not refresh_token:
            log.error("gcal.no_refresh_token", tenant_id=tenant_id, user_id=user_id)
            await self._mark_integration_error(tenant_id, user_id, "no_refresh_token")
            return None

        try:
            async with httpx.AsyncClient(timeout=10) as client:
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
            expires_in       = data.get("expires_in", 3600)
            new_expiry       = datetime.fromtimestamp(
                time.time() + expires_in, tz=timezone.utc
            )

            await self.db.execute(
                """
                UPDATE oauth_tokens
                SET access_token = $1, expires_at = $2, updated_at = NOW()
                WHERE tenant_id = $3 AND user_id = $4 AND provider = 'google'
                """,
                new_access_token, new_expiry, tenant_id, user_id,
            )
            log.info("gcal.token_refreshed", tenant_id=tenant_id, user_id=user_id)
            return new_access_token

        except Exception as exc:
            log.error("gcal.refresh_failed", error=str(exc), tenant_id=tenant_id)
            await self._mark_integration_error(tenant_id, user_id, str(exc))
            return None

    async def _mark_integration_error(
        self, tenant_id: str, user_id: str, reason: str
    ) -> None:
        try:
            await self.db.execute(
                """
                UPDATE integrations
                SET status = 'error', error_message = $1, updated_at = NOW()
                WHERE tenant_id = $2 AND user_id = $3 AND provider = 'google'
                """,
                reason[:500], tenant_id, user_id,
            )
        except Exception:
            pass  # integrations table may not exist yet

    # ── Push channel setup ────────────────────────────────────────────────────

    async def setup_watch(
        self,
        tenant_id: str,
        user_id: str,
        calendar_id: str = "primary",
    ) -> dict | None:
        """
        Set up a Google Calendar push notification channel.
        Stores channel_id + resource_id + next_sync_token in oauth_tokens.metadata.
        """
        token = await self.get_valid_token(tenant_id, user_id)
        if not token:
            return None

        channel_id    = str(uuid.uuid4())
        webhook_url   = f"{settings.API_GATEWAY_URL}/ingestion/gcal/notifications"
        expiration_ms = int((time.time() + WATCH_EXPIRY_SECS) * 1000)

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                # First, fetch initial sync token
                sync_resp = await client.get(
                    GCAL_EVENTS_URL.format(calendar_id=calendar_id),
                    headers={"Authorization": f"Bearer {token}"},
                    params={"maxResults": 1, "showDeleted": False},
                )
                sync_resp.raise_for_status()
                next_sync_token = sync_resp.json().get("nextSyncToken")

                # Set up push channel
                watch_resp = await client.post(
                    GCAL_WATCH_URL.format(calendar_id=calendar_id),
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "id":         channel_id,
                        "type":       "web_hook",
                        "address":    webhook_url,
                        "expiration": expiration_ms,
                    },
                )
                watch_resp.raise_for_status()
                watch_data = watch_resp.json()

        except Exception as exc:
            log.error("gcal.setup_watch_failed", error=str(exc), tenant_id=tenant_id)
            return None

        # Persist channel metadata alongside oauth token
        metadata = {
            "gcal_channel_id":    channel_id,
            "gcal_resource_id":   watch_data.get("resourceId"),
            "gcal_next_sync_token": next_sync_token,
            "gcal_watch_expires": expiration_ms,
            "gcal_calendar_id":   calendar_id,
        }
        await self.db.execute(
            """
            UPDATE oauth_tokens
            SET metadata = COALESCE(metadata, '{}') || $1::jsonb, updated_at = NOW()
            WHERE tenant_id = $2 AND user_id = $3 AND provider = 'google'
            """,
            json.dumps(metadata), tenant_id, user_id,
        )
        log.info("gcal.watch_created", channel_id=channel_id, tenant_id=tenant_id)
        return watch_data

    # ── Incremental event fetch ───────────────────────────────────────────────

    async def fetch_new_events(
        self,
        tenant_id: str,
        user_id: str,
        calendar_id: str = "primary",
    ) -> list[dict[str, Any]]:
        """
        Incremental sync via nextSyncToken.
        Returns new/updated events since last sync; updates stored sync token.
        """
        token = await self.get_valid_token(tenant_id, user_id)
        if not token:
            return []

        meta_row = await self.db.fetchrow(
            "SELECT metadata FROM oauth_tokens WHERE tenant_id=$1 AND user_id=$2 AND provider='google'",
            tenant_id, user_id,
        )
        metadata = meta_row["metadata"] or {} if meta_row else {}
        if isinstance(metadata, str):
            metadata = json.loads(metadata)

        sync_token   = metadata.get("gcal_next_sync_token")
        cal_id       = metadata.get("gcal_calendar_id", calendar_id)
        events: list[dict] = []
        new_sync_token: str | None = None

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                params: dict[str, Any] = {"maxResults": 250, "singleEvents": True}
                if sync_token:
                    params["syncToken"] = sync_token
                else:
                    # Full sync: last 30 days
                    params["timeMin"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

                while True:
                    resp = await client.get(
                        GCAL_EVENTS_URL.format(calendar_id=cal_id),
                        headers={"Authorization": f"Bearer {token}"},
                        params=params,
                    )

                    # 410 Gone means sync token expired — do full sync
                    if resp.status_code == 410:
                        log.warning("gcal.sync_token_expired", tenant_id=tenant_id)
                        params.pop("syncToken", None)
                        params["timeMin"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
                        continue

                    resp.raise_for_status()
                    data = resp.json()

                    events.extend(data.get("items", []))
                    new_sync_token = data.get("nextSyncToken")

                    next_page = data.get("nextPageToken")
                    if not next_page:
                        break
                    params["pageToken"] = next_page
                    params.pop("syncToken", None)

        except Exception as exc:
            log.error("gcal.fetch_failed", error=str(exc), tenant_id=tenant_id)
            return []

        # Persist updated sync token
        if new_sync_token:
            updated_meta = {**metadata, "gcal_next_sync_token": new_sync_token}
            await self.db.execute(
                """
                UPDATE oauth_tokens
                SET metadata = $1::jsonb, updated_at = NOW()
                WHERE tenant_id = $2 AND user_id = $3 AND provider = 'google'
                """,
                json.dumps(updated_meta), tenant_id, user_id,
            )

        # Filter out cancelled/deleted and events without attendees (solo blocks)
        meaningful = [
            e for e in events
            if e.get("status") != "cancelled"
            and len(e.get("attendees", [])) >= 2  # only multi-party events
        ]
        log.info("gcal.events_fetched", count=len(meaningful), tenant_id=tenant_id)
        return meaningful
