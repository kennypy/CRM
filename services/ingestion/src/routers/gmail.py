"""
Gmail ingestion router.
Handles Google Pub/Sub push notifications for Gmail watch.

Security:
  * C2 — every push request is authenticated by verifying the Google-signed
    OIDC JWT carried in the `Authorization: Bearer <jwt>` header (issuer must be
    Google, signature verified against Google's public certs, audience matched
    against GMAIL_PUBSUB_AUDIENCE when configured). Unverified pushes get 401.
  * C3 — the owning tenant_id/user_id is resolved from the payload emailAddress
    against the oauth_tokens table (provider='google'); pushes that don't resolve
    to a known integration are acked (200) but skipped — never published with a
    placeholder tenant.
"""

import json
import base64
import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import asyncpg
import redis.asyncio as aioredis

from ..config import settings
from ..models import RawSignalEvent

router = APIRouter()
log = structlog.get_logger()

# Accepted issuers for Google-issued OIDC tokens.
_GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")


class PubSubMessage(BaseModel):
    message: dict
    subscription: str


def _verify_pubsub_jwt(authorization: str | None) -> bool:
    """
    Verify the OIDC JWT attached to a Google Pub/Sub push request.

    Returns True only if the token is a valid, unexpired, Google-signed token
    whose issuer is Google and (when GMAIL_PUBSUB_AUDIENCE is configured) whose
    audience matches the expected push-endpoint audience. Any failure -> False.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return False
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return False

    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
    except ImportError:
        # google-auth must be installed (it is pinned in requirements.txt). Fail
        # closed: without it we cannot prove authenticity.
        log.error("gmail.google_auth_unavailable")
        return False

    expected_audience = settings.GMAIL_PUBSUB_AUDIENCE or None
    try:
        claims = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            audience=expected_audience,
        )
    except Exception as exc:
        log.warning("gmail.jwt_verification_failed", error=str(exc))
        return False

    if claims.get("iss") not in _GOOGLE_ISSUERS:
        log.warning("gmail.jwt_bad_issuer", iss=claims.get("iss"))
        return False

    return True


async def _resolve_owner(email_address: str | None) -> dict | None:
    """
    Resolve the NexCRM tenant_id/user_id that owns a Google integration for the
    given mailbox address. Returns {tenant_id, user_id} or None if no matching
    google oauth_tokens row exists.
    """
    if not email_address:
        return None

    db = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=2)
    try:
        row = await db.fetchrow(
            """
            SELECT tenant_id, user_id
            FROM oauth_tokens
            WHERE provider = 'google'
              AND lower(metadata->>'gmail_email_address') = lower($1)
            LIMIT 1
            """,
            email_address,
        )
    finally:
        await db.close()

    if not row:
        return None
    return {"tenant_id": str(row["tenant_id"]), "user_id": str(row["user_id"])}


@router.post("/push")
async def gmail_push_notification(request: Request):
    """Receive a Gmail Pub/Sub push notification (authenticated)."""
    # C2: authenticate the push before doing any work.
    if not _verify_pubsub_jwt(request.headers.get("authorization")):
        raise HTTPException(status_code=401, detail="Unauthorized push")

    try:
        envelope = await request.json()
        body = PubSubMessage(**envelope)
    except Exception as e:
        log.warning("gmail.bad_envelope", error=str(e))
        raise HTTPException(status_code=400, detail="Malformed Pub/Sub envelope")

    try:
        data = json.loads(base64.b64decode(body.message.get("data", "")).decode())
        email_address = data.get("emailAddress")
        history_id = data.get("historyId")

        log.info("gmail.push_received", email=email_address, history_id=history_id)

        # C3: resolve the owning tenant/user from the mailbox address. Never
        # publish with a placeholder tenant.
        owner = await _resolve_owner(email_address)
        if not owner:
            # Ack the push so Pub/Sub stops retrying, but do not process an
            # unknown mailbox.
            log.warning("gmail.unresolved_mailbox", email=email_address)
            return {"status": "ignored", "reason": "unknown_mailbox"}

        redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

        raw_event = RawSignalEvent(
            tenant_id=owner["tenant_id"],
            user_id=owner["user_id"],
            source="gmail",
            source_event_id=str(history_id),
            raw_payload=data,
        )

        await redis.xadd(
            settings.STREAM_RAW_SIGNALS,
            {"data": raw_event.model_dump_json()},
        )
        await redis.aclose()

        return {"status": "ok"}

    except HTTPException:
        raise
    except Exception as e:
        log.error("gmail.push_error", error=str(e))
        raise HTTPException(status_code=500, detail="Processing failed")
