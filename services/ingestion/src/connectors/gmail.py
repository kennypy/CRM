"""
Gmail API Connector
====================
Handles all direct communication with the Gmail API:
  - Token refresh (access tokens expire after 1 hour)
  - Gmail watch setup (Pub/Sub push notifications)
  - History list fetch (incremental sync from a history ID)
  - Full message fetch (with body extraction)

Design decisions:
  - Every API call checks token expiry and refreshes proactively
  - Token updates are written back to the oauth_tokens table immediately
  - We use history-based sync (not full mailbox poll) to minimise quota use
  - Only fetches UNREAD + INBOX messages to avoid processing sent mail twice
    (sent mail processed from the 'SENT' label separately)
"""

import asyncio
import json
import logging
from typing import Any

import asyncpg
import httpx

from .google_oauth import get_valid_google_token

log = logging.getLogger(__name__)

GMAIL_API_BASE    = "https://gmail.googleapis.com/gmail/v1"
PUBSUB_TOPIC      = "projects/{project_id}/topics/nexcrm-gmail-push"


class GmailConnector:
    """
    Stateless connector — receives the db pool on init.
    One instance can handle multiple users' tokens.
    """

    def __init__(self, db_pool: asyncpg.Pool, pubsub_topic: str = ""):
        self.db = db_pool
        self.pubsub_topic = pubsub_topic

    # ── Token management (shared with the Calendar connector) ─────────────────

    async def get_valid_token(self, tenant_id: str, user_id: str) -> str | None:
        return await get_valid_google_token(self.db, tenant_id, user_id)

    # ── Gmail Watch (Pub/Sub push setup) ─────────────────────────────────────

    async def setup_watch(self, tenant_id: str, user_id: str) -> dict[str, Any] | None:
        """
        Set up a Gmail push notification watch for this user.
        Must be called after OAuth connection AND renewed every 7 days (Google's limit).
        Stores the history_id in oauth_tokens.metadata for incremental sync.
        """
        token = await self.get_valid_token(tenant_id, user_id)
        if not token:
            return None

        async with httpx.AsyncClient(timeout=15) as http:
            # Fetch the mailbox address so inbound Pub/Sub pushes (which carry
            # only the emailAddress) can be resolved back to this tenant/user
            # row. See routers/gmail.py::_resolve_owner (C3).
            email_address: str | None = None
            profile_resp = await http.get(
                f"{GMAIL_API_BASE}/users/me/profile",
                headers={"Authorization": f"Bearer {token}"},
            )
            if profile_resp.status_code == 200:
                email_address = profile_resp.json().get("emailAddress")
            else:
                log.warning("gmail.profile_fetch_failed user=%s status=%s",
                            user_id, profile_resp.status_code)

            resp = await http.post(
                f"{GMAIL_API_BASE}/users/me/watch",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "topicName": self.pubsub_topic,
                    "labelIds":  ["INBOX", "SENT"],
                },
            )

        if resp.status_code != 200:
            log.error("gmail.watch_failed user=%s status=%s body=%s",
                      user_id, resp.status_code, resp.text[:200])
            return None

        data = resp.json()
        history_id = data.get("historyId")

        # Store history_id (incremental sync) + mailbox address (push resolution)
        watch_meta: dict[str, Any] = {
            "gmail_history_id": history_id,
            "watch_expires_at": data.get("expiration"),
        }
        if email_address:
            watch_meta["gmail_email_address"] = email_address
        await self.db.execute(
            """UPDATE oauth_tokens
               SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
                   updated_at = NOW()
               WHERE tenant_id = $2 AND user_id = $3 AND provider = 'google'""",
            json.dumps(watch_meta),
            tenant_id, user_id,
        )

        await self.db.execute(
            """UPDATE integrations
               SET status = 'active', last_synced_at = NOW(), error_message = NULL
               WHERE tenant_id = $1 AND user_id = $2 AND provider = 'google'""",
            tenant_id, user_id,
        )

        log.info("gmail.watch_setup user=%s history_id=%s", user_id, history_id)
        return data

    # ── Incremental message fetch ─────────────────────────────────────────────

    async def fetch_new_messages(
        self, tenant_id: str, user_id: str, start_history_id: str
    ) -> list[dict[str, Any]]:
        """
        Fetch all messages added since start_history_id using the history API.
        Returns a list of full message payloads (with headers + body).
        """
        token = await self.get_valid_token(tenant_id, user_id)
        if not token:
            return []

        async with httpx.AsyncClient(timeout=30) as http:
            # Step 1: get history of changes since last history_id
            hist_resp = await http.get(
                f"{GMAIL_API_BASE}/users/me/history",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "startHistoryId": start_history_id,
                    "historyTypes":   "messageAdded",
                    "labelId":        "INBOX",
                },
            )

        if hist_resp.status_code == 404:
            # History expired — need full re-sync; reset watch
            log.warning("gmail.history_expired user=%s", user_id)
            await self.setup_watch(tenant_id, user_id)
            return []

        if hist_resp.status_code != 200:
            log.error("gmail.history_fetch_failed status=%s", hist_resp.status_code)
            return []

        hist_data = hist_resp.json()
        new_history_id = hist_data.get("historyId", start_history_id)

        # Update stored history_id for next poll
        await self.db.execute(
            """UPDATE oauth_tokens
               SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
               WHERE tenant_id = $2 AND user_id = $3 AND provider = 'google'""",
            json.dumps({"gmail_history_id": new_history_id}),
            tenant_id, user_id,
        )

        # Collect message IDs from history
        message_ids: list[str] = []
        for history_entry in hist_data.get("history", []):
            for added in history_entry.get("messagesAdded", []):
                msg_id = added.get("message", {}).get("id")
                if msg_id:
                    message_ids.append(msg_id)

        if not message_ids:
            return []

        log.info("gmail.fetching_messages user=%s count=%d", user_id, len(message_ids))

        # Step 2: fetch full message payloads (concurrent, max 10 at a time)
        messages = await self._fetch_messages_batch(token, message_ids)
        return messages

    async def _fetch_messages_batch(
        self, token: str, message_ids: list[str]
    ) -> list[dict[str, Any]]:
        """Fetch full message payloads concurrently, respecting Gmail rate limits."""
        semaphore = asyncio.Semaphore(5)  # max 5 concurrent requests

        async def fetch_one(msg_id: str) -> dict[str, Any] | None:
            async with semaphore:
                async with httpx.AsyncClient(timeout=15) as http:
                    resp = await http.get(
                        f"{GMAIL_API_BASE}/users/me/messages/{msg_id}",
                        headers={"Authorization": f"Bearer {token}"},
                        params={"format": "full"},
                    )
                if resp.status_code == 200:
                    return resp.json()
                log.warning("gmail.message_fetch_failed msg_id=%s status=%s",
                            msg_id, resp.status_code)
                return None

        results = await asyncio.gather(*[fetch_one(mid) for mid in message_ids])
        return [r for r in results if r is not None]
