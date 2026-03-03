"""
Outlook / Microsoft Graph Connector
=====================================
Handles OAuth token refresh and incremental email/calendar sync via
Microsoft Graph delta queries.

Architecture:
  1. get_valid_token()  — proactive MSAL-based token refresh
  2. setup_subscription()— creates Graph change notification subscription
  3. fetch_messages()   — delta query for new emails since last sync
  4. fetch_event()      — fetch a single calendar event by ID (for webhooks)

All fetched payloads are raw Graph API objects; normalize_outlook() in the
normalizer worker converts them to canonical ActivityEvent.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

import asyncpg
import httpx
import structlog

from ..config import settings

log = structlog.get_logger()

MICROSOFT_TOKEN_URL   = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
GRAPH_BASE            = "https://graph.microsoft.com/v1.0"
GRAPH_ME_MESSAGES     = f"{GRAPH_BASE}/me/mailFolders/inbox/messages/delta"
GRAPH_ME_EVENTS       = f"{GRAPH_BASE}/me/events/delta"
GRAPH_SUBSCRIPTIONS   = f"{GRAPH_BASE}/subscriptions"
TOKEN_REFRESH_BUFFER  = 300   # seconds before expiry to refresh


class OutlookConnector:
    """Per-user Microsoft Graph (Outlook + Calendar) integration."""

    def __init__(self, db_pool: asyncpg.Pool):
        self.db = db_pool

    # ── Token management ──────────────────────────────────────────────────────

    async def get_valid_token(self, tenant_id: str, user_id: str) -> str | None:
        row = await self.db.fetchrow(
            """
            SELECT access_token, refresh_token, expires_at
            FROM oauth_tokens
            WHERE tenant_id = $1 AND user_id = $2 AND provider = 'microsoft'
            """,
            tenant_id, user_id,
        )
        if not row:
            return None

        if row["expires_at"]:
            remaining = (
                row["expires_at"].replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
            ).total_seconds()
            if remaining < TOKEN_REFRESH_BUFFER:
                return await self._refresh_token(tenant_id, user_id, row["refresh_token"])

        return row["access_token"]

    async def _refresh_token(
        self, tenant_id: str, user_id: str, refresh_token: str | None
    ) -> str | None:
        if not refresh_token:
            await self._mark_error(tenant_id, user_id, "no_refresh_token")
            return None

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    MICROSOFT_TOKEN_URL,
                    data={
                        "grant_type":    "refresh_token",
                        "refresh_token": refresh_token,
                        "client_id":     settings.MICROSOFT_CLIENT_ID,
                        "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                        "scope":         "https://graph.microsoft.com/.default offline_access",
                    },
                )
            resp.raise_for_status()
            data = resp.json()

            new_token  = data["access_token"]
            expires_at = datetime.fromtimestamp(
                time.time() + data.get("expires_in", 3600), tz=timezone.utc
            )
            new_refresh = data.get("refresh_token", refresh_token)

            await self.db.execute(
                """
                UPDATE oauth_tokens
                SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW()
                WHERE tenant_id = $4 AND user_id = $5 AND provider = 'microsoft'
                """,
                new_token, new_refresh, expires_at, tenant_id, user_id,
            )
            log.info("outlook.token_refreshed", tenant_id=tenant_id, user_id=user_id)
            return new_token

        except Exception as exc:
            log.error("outlook.refresh_failed", error=str(exc))
            await self._mark_error(tenant_id, user_id, str(exc))
            return None

    async def _mark_error(self, tenant_id: str, user_id: str, reason: str) -> None:
        try:
            await self.db.execute(
                """
                UPDATE integrations
                SET status = 'error', error_message = $1, updated_at = NOW()
                WHERE tenant_id = $2 AND user_id = $3 AND provider = 'microsoft'
                """,
                reason[:500], tenant_id, user_id,
            )
        except Exception:
            pass

    # ── Webhook subscription ──────────────────────────────────────────────────

    async def setup_subscription(
        self,
        tenant_id: str,
        user_id: str,
        resource: str = "me/mailFolders/inbox/messages",
    ) -> dict | None:
        """
        Create a Microsoft Graph change notification subscription.
        Subscription ID is stored in oauth_tokens.metadata.
        """
        token = await self.get_valid_token(tenant_id, user_id)
        if not token:
            return None

        webhook_url = f"{settings.API_GATEWAY_URL}/ingestion/outlook/notifications"
        # Graph subscriptions expire after max 4230 minutes (≈3 days) for mail
        expiry = datetime.fromtimestamp(
            time.time() + 3 * 24 * 3600, tz=timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%S.0000000Z")

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    GRAPH_SUBSCRIPTIONS,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type":  "application/json",
                    },
                    json={
                        "changeType":         "created,updated",
                        "notificationUrl":    webhook_url,
                        "resource":           resource,
                        "expirationDateTime": expiry,
                        "clientState":        tenant_id,   # verified in webhook handler
                    },
                )
            resp.raise_for_status()
            sub_data = resp.json()
        except Exception as exc:
            log.error("outlook.setup_subscription_failed", error=str(exc))
            return None

        meta = {
            "outlook_subscription_id": sub_data.get("id"),
            "outlook_resource":        resource,
            "outlook_sub_expires":     expiry,
        }
        await self.db.execute(
            """
            UPDATE oauth_tokens
            SET metadata = COALESCE(metadata, '{}') || $1::jsonb, updated_at = NOW()
            WHERE tenant_id = $2 AND user_id = $3 AND provider = 'microsoft'
            """,
            json.dumps(meta), tenant_id, user_id,
        )
        log.info("outlook.subscription_created", sub_id=sub_data.get("id"))
        return sub_data

    # ── Incremental message fetch ─────────────────────────────────────────────

    async def fetch_messages(
        self, tenant_id: str, user_id: str
    ) -> list[dict[str, Any]]:
        """
        Delta query for new inbox messages since last sync.
        Stores deltaLink in oauth_tokens.metadata for incremental pagination.
        """
        token = await self.get_valid_token(tenant_id, user_id)
        if not token:
            return []

        meta_row = await self.db.fetchrow(
            "SELECT metadata FROM oauth_tokens WHERE tenant_id=$1 AND user_id=$2 AND provider='microsoft'",
            tenant_id, user_id,
        )
        metadata = meta_row["metadata"] or {} if meta_row else {}
        if isinstance(metadata, str):
            metadata = json.loads(metadata)

        delta_link = metadata.get("outlook_delta_link")
        url = delta_link or GRAPH_ME_MESSAGES

        messages: list[dict] = []
        new_delta_link: str | None = None

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                while url:
                    resp = await client.get(
                        url,
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Prefer": 'outlook.body-content-type="text"',  # plain text body
                        },
                        params={"$top": 50, "$select": "id,subject,from,toRecipients,ccRecipients,body,receivedDateTime,conversationId,hasAttachments"} if not delta_link else {},
                    )
                    # 410 means deltaLink expired — restart
                    if resp.status_code == 410:
                        log.warning("outlook.delta_expired", tenant_id=tenant_id)
                        url = GRAPH_ME_MESSAGES
                        delta_link = None
                        continue

                    resp.raise_for_status()
                    data = resp.json()

                    messages.extend(data.get("value", []))
                    new_delta_link = data.get("@odata.deltaLink")
                    url = data.get("@odata.nextLink")  # type: ignore[assignment]

        except Exception as exc:
            log.error("outlook.fetch_messages_failed", error=str(exc))
            return []

        if new_delta_link:
            updated = {**metadata, "outlook_delta_link": new_delta_link}
            await self.db.execute(
                """
                UPDATE oauth_tokens SET metadata = $1::jsonb, updated_at = NOW()
                WHERE tenant_id = $2 AND user_id = $3 AND provider = 'microsoft'
                """,
                json.dumps(updated), tenant_id, user_id,
            )

        log.info("outlook.messages_fetched", count=len(messages), tenant_id=tenant_id)
        return messages

    # ── Fetch single item by Graph resource ID ────────────────────────────────

    async def fetch_message_by_id(
        self, tenant_id: str, user_id: str, message_id: str
    ) -> dict | None:
        token = await self.get_valid_token(tenant_id, user_id)
        if not token:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{GRAPH_BASE}/me/messages/{message_id}",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Prefer": 'outlook.body-content-type="text"',
                    },
                )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            log.error("outlook.fetch_message_failed", error=str(exc), msg_id=message_id)
            return None

    async def fetch_event_by_id(
        self, tenant_id: str, user_id: str, event_id: str
    ) -> dict | None:
        token = await self.get_valid_token(tenant_id, user_id)
        if not token:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{GRAPH_BASE}/me/events/{event_id}",
                    headers={"Authorization": f"Bearer {token}"},
                )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            log.error("outlook.fetch_event_failed", error=str(exc), event_id=event_id)
            return None
