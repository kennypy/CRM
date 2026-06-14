"""
Entity Resolver Worker
======================
Reads ActivityEvents from nexcrm:normalized-signals.
For each event, resolves participant emails to existing Person/Company
graph nodes (or creates new ones at high confidence).

Resolution strategy (in order):
  1. Exact email match in AGE graph — highest confidence (1.0)
  2. Domain match → Company node  — high confidence (0.9)
  3. Name + domain similarity     — medium confidence (0.75)
  4. No match → create new node  — if confidence > CREATE_THRESHOLD

After resolution, publishes an enriched event to nexcrm:resolved-signals
for the LLM extraction worker to consume.
"""

import json
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg
import redis.asyncio as aioredis

from ..config import settings

log = logging.getLogger(__name__)

CREATE_THRESHOLD = 0.85  # minimum confidence to auto-create a new node
# Confidence applied to an unaligned/unverified sender. Deliberately below
# CREATE_THRESHOLD so such senders are NOT auto-created — they fall through to
# the review queue instead (M-ING2: senders are spoofable).
UNALIGNED_CONFIDENCE = 0.5


def _sender_is_aligned(activity: dict[str, Any]) -> bool | None:
    """
    Determine whether the activity's sender passed email authentication
    (SPF/DKIM/DMARC alignment).

    Returns:
      True  — at least one authentication signal is present AND passing, and
              none are explicitly failing.
      False — at least one authentication signal is present and explicitly failing.
      None  — the normalized event carries no authentication signals at all
              (schema does not surface them yet); the caller must treat this
              conservatively (do not auto-create).

    Accepts a few common shapes so this stays forward-compatible with whatever
    the normalizer eventually emits:
      activity["auth_results"] = {"spf": "pass", "dkim": "pass", "dmarc": "pass"}
      activity["spf_pass"] / ["dkim_pass"] / ["dmarc_pass"] = bool
    """
    flags: list[bool] = []

    auth = activity.get("auth_results")
    if isinstance(auth, dict):
        for key in ("spf", "dkim", "dmarc"):
            val = auth.get(key)
            if val is None:
                continue
            if isinstance(val, bool):
                flags.append(val)
            elif isinstance(val, str):
                flags.append(val.strip().lower() == "pass")

    for key in ("spf_pass", "dkim_pass", "dmarc_pass"):
        val = activity.get(key)
        if isinstance(val, bool):
            flags.append(val)

    if not flags:
        return None
    # Aligned only if every present signal passes (a single explicit fail ->
    # not aligned).
    return all(flags)


class EntityResolver:
    def __init__(self, db_pool: asyncpg.Pool, redis_client: aioredis.Redis):
        self.db = db_pool
        self.redis = redis_client

    async def resolve_activity(self, activity: dict[str, Any]) -> dict[str, Any]:
        """
        Resolve all participant emails in an activity to graph node IDs.
        Returns the enriched activity dict ready for the extraction worker.
        """
        tenant_id = activity["tenant_id"]
        emails = self._collect_emails(activity)

        # Sender authenticity signal. The sender (from_email) is the only
        # spoofable-via-header participant whose mere presence we'd otherwise
        # treat as ground truth, so auto-creation is gated on it being aligned.
        sender = (activity.get("from_email") or "").lower().strip()
        sender_aligned = _sender_is_aligned(activity)

        resolved: dict[str, dict[str, Any]] = {}

        for email in emails:
            if not email or "@" not in email:
                continue
            # Only the sender carries the spoofability concern. For recipient
            # addresses (to/cc/participants) there is no sender-alignment signal,
            # so we treat them as aligned for the purposes of this gate.
            is_sender = email == sender
            aligned = sender_aligned if is_sender else True
            result = await self._resolve_email(tenant_id, email, aligned=aligned)
            resolved[email] = result

        # Also resolve the domain to a Company node. Gate the sender's domain on
        # the same alignment signal.
        company_resolutions: dict[str, dict[str, Any]] = {}
        sender_domain = sender.split("@")[1] if "@" in sender else None
        domains = {e.split("@")[1] for e in emails if "@" in e}
        for domain in domains:
            aligned = sender_aligned if domain == sender_domain else True
            result = await self._resolve_domain(tenant_id, domain, aligned=aligned)
            company_resolutions[domain] = result

        return {
            **activity,
            "resolved_persons":  resolved,
            "resolved_companies": company_resolutions,
            "resolution_at": datetime.now(timezone.utc).isoformat(),
        }

    # ── Email → Person node ──────────────────────────────────────────────────

    async def _resolve_email(
        self, tenant_id: str, email: str, aligned: bool | None = True
    ) -> dict[str, Any]:
        email = email.lower().strip()

        # 1. Exact match in graph (via Postgres relational lookup on embeddings table)
        # We use the node_embeddings table which tracks node IDs + content hashes.
        # For a fast lookup without Cypher overhead, we maintain a denormalised
        # email→node_id index in a Postgres table.
        row = await self.db.fetchrow(
            """SELECT node_id FROM person_email_index
               WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL
               LIMIT 1""",
            tenant_id, email,
        )

        if row:
            return {"node_id": row["node_id"], "email": email,
                    "is_new": False, "confidence": 1.0, "match_type": "exact_email"}

        # 2. No match — decide whether to auto-create a new Person node stub.
        # We create it with low confidence fields; the LLM extraction worker
        # will enrich name/title/role from the email content.
        if not await self._should_create(email):
            return {"node_id": None, "email": email,
                    "is_new": False, "confidence": 0.0, "match_type": "no_match"}

        # M-ING2: senders are spoofable. Only auto-create when the sender is
        # cryptographically aligned (SPF/DKIM/DMARC pass). If alignment is
        # unknown (flags absent from the event) or failing, lower confidence
        # below CREATE_THRESHOLD and route to the review queue instead.
        if aligned is not True:
            log.info(
                "entity_resolver.person_unaligned email=%s aligned=%s -> review",
                email, aligned,
            )
            await self._enqueue_review(
                tenant_id, kind="person", identifier=email,
                reason="sender_not_aligned" if aligned is False else "no_auth_signal",
            )
            return {"node_id": None, "email": email, "is_new": False,
                    "confidence": UNALIGNED_CONFIDENCE, "match_type": "review_unaligned"}

        # Per-tenant rate limit on auto-creation (defence-in-depth against a
        # flood of spoofed-but-aligned-looking senders).
        if not await self._within_create_limit(tenant_id):
            log.warning("entity_resolver.create_rate_limited tenant=%s email=%s",
                        tenant_id, email)
            await self._enqueue_review(
                tenant_id, kind="person", identifier=email, reason="rate_limited",
            )
            return {"node_id": None, "email": email, "is_new": False,
                    "confidence": UNALIGNED_CONFIDENCE, "match_type": "review_rate_limited"}

        node_id = await self._create_person_stub(tenant_id, email)
        return {"node_id": node_id, "email": email,
                "is_new": True, "confidence": CREATE_THRESHOLD, "match_type": "created"}

    async def _resolve_domain(
        self, tenant_id: str, domain: str, aligned: bool | None = True
    ) -> dict[str, Any]:
        row = await self.db.fetchrow(
            """SELECT node_id FROM company_domain_index
               WHERE tenant_id = $1 AND domain = $2 AND deleted_at IS NULL
               LIMIT 1""",
            tenant_id, domain,
        )

        if row:
            return {"node_id": row["node_id"], "domain": domain,
                    "is_new": False, "confidence": 0.95, "match_type": "exact_domain"}

        # Only consider real business domains for creation.
        if _is_free_email_provider(domain):
            return {"node_id": None, "domain": domain,
                    "is_new": False, "confidence": 0.0, "match_type": "free_provider"}

        # M-ING2: gate auto-creation of the sender's company on sender alignment.
        if aligned is not True:
            log.info(
                "entity_resolver.company_unaligned domain=%s aligned=%s -> review",
                domain, aligned,
            )
            await self._enqueue_review(
                tenant_id, kind="company", identifier=domain,
                reason="sender_not_aligned" if aligned is False else "no_auth_signal",
            )
            return {"node_id": None, "domain": domain, "is_new": False,
                    "confidence": UNALIGNED_CONFIDENCE, "match_type": "review_unaligned"}

        if not await self._within_create_limit(tenant_id):
            log.warning("entity_resolver.create_rate_limited tenant=%s domain=%s",
                        tenant_id, domain)
            await self._enqueue_review(
                tenant_id, kind="company", identifier=domain, reason="rate_limited",
            )
            return {"node_id": None, "domain": domain, "is_new": False,
                    "confidence": UNALIGNED_CONFIDENCE, "match_type": "review_rate_limited"}

        node_id = await self._create_company_stub(tenant_id, domain)
        return {"node_id": node_id, "domain": domain,
                "is_new": True, "confidence": CREATE_THRESHOLD, "match_type": "created"}

    # ── Graph node creation ──────────────────────────────────────────────────

    async def _create_person_stub(self, tenant_id: str, email: str) -> str:
        node_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        # Write to graph via internal API (avoids direct Cypher dependency here)
        # In production: publish to Redis Stream for graph-core to process
        await self.redis.xadd(
            settings.STREAM_CRM_WRITES,
            {"data": json.dumps({
                "operation": "create_node",
                "label": "Person",
                "tenant_id": tenant_id,
                "properties": {
                    "id": node_id,
                    "tenant_id": tenant_id,
                    "email": email,
                    "first_name": "",
                    "last_name": "",
                    "source": "ingestion",
                    "created_at": now,
                    "updated_at": now,
                },
            })},
        )

        # Also maintain the email index for fast lookup
        await self.db.execute(
            """INSERT INTO person_email_index (tenant_id, email, node_id, created_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (tenant_id, email) DO NOTHING""",
            tenant_id, email, node_id,
        )

        log.info("entity_resolver.created_person email=%s node_id=%s", email, node_id)
        return node_id

    async def _create_company_stub(self, tenant_id: str, domain: str) -> str:
        node_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        company_name = _domain_to_name(domain)

        await self.redis.xadd(
            settings.STREAM_CRM_WRITES,
            {"data": json.dumps({
                "operation": "create_node",
                "label": "Company",
                "tenant_id": tenant_id,
                "properties": {
                    "id": node_id,
                    "tenant_id": tenant_id,
                    "domain": domain,
                    "name": company_name,
                    "source": "ingestion",
                    "created_at": now,
                    "updated_at": now,
                },
            })},
        )

        await self.db.execute(
            """INSERT INTO company_domain_index (tenant_id, domain, node_id, created_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (tenant_id, domain) DO NOTHING""",
            tenant_id, domain, node_id,
        )

        log.info("entity_resolver.created_company domain=%s node_id=%s", domain, node_id)
        return node_id

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _collect_emails(self, activity: dict[str, Any]) -> list[str]:
        emails = set()
        for field in ("from_email", ):
            if v := activity.get(field):
                emails.add(v.lower())
        for field in ("to_emails", "cc_emails", "participant_emails"):
            for e in activity.get(field, []):
                if e:
                    emails.add(e.lower())
        return list(emails)

    async def _within_create_limit(self, tenant_id: str) -> bool:
        """
        Per-tenant rolling-window rate limit on node auto-creation.

        Uses a Redis counter keyed per tenant + time bucket. Fails OPEN if Redis
        is unavailable so a Redis outage never silently blocks legitimate
        ingestion (the alignment gate remains the primary control).
        """
        limit = settings.ENTITY_AUTO_CREATE_LIMIT
        window = settings.ENTITY_AUTO_CREATE_WINDOW_SECONDS
        if limit <= 0:
            return True
        try:
            bucket = int(datetime.now(timezone.utc).timestamp()) // window
            key = f"nexcrm:entity-create-rate:{tenant_id}:{bucket}"
            count = await self.redis.incr(key)
            if count == 1:
                await self.redis.expire(key, window)
            return count <= limit
        except Exception as e:
            log.warning("entity_resolver.rate_limit_check_failed tenant=%s error=%s",
                        tenant_id, e)
            return True

    async def _enqueue_review(
        self, tenant_id: str, kind: str, identifier: str, reason: str
    ) -> None:
        """
        Route a candidate that was NOT auto-created into the human review queue
        instead of silently dropping it. Best-effort: failures are logged, never
        raised, so resolution of the rest of the activity proceeds.
        """
        extraction_id = f"entity-create:{kind}:{identifier}"
        summary = f"Proposed new {kind} '{identifier}' held for review ({reason})"
        proposed = {
            "operation": "create_node",
            "kind": kind,
            "identifier": identifier,
            "reason": reason,
        }
        try:
            await self.db.execute(
                """
                INSERT INTO review_queue
                    (tenant_id, extraction_id, status, confidence, summary,
                     proposed_changes, evidence)
                VALUES ($1, $2, 'pending', $3, $4, $5::jsonb, $6)
                """,
                tenant_id, extraction_id, UNALIGNED_CONFIDENCE, summary,
                json.dumps(proposed), f"auto_create_blocked:{reason}",
            )
        except Exception as e:
            log.warning("entity_resolver.review_enqueue_failed kind=%s id=%s error=%s",
                        kind, identifier, e)

    async def _should_create(self, email: str) -> bool:
        """Don't create nodes for no-reply, automated, or free-email addresses."""
        blocklist = ("noreply", "no-reply", "donotreply", "mailer-daemon",
                     "bounce", "postmaster", "support@", "info@", "hello@")
        lc = email.lower()
        if any(b in lc for b in blocklist):
            return False
        domain = lc.split("@")[1]
        return not _is_free_email_provider(domain)


# ── Stream consumer loop ─────────────────────────────────────────────────────

async def start_resolver_worker(db_pool: asyncpg.Pool):
    redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    resolver = EntityResolver(db_pool, redis)

    consumer_group = "resolver"
    stream = settings.STREAM_NORMALIZED

    try:
        await redis.xgroup_create(stream, consumer_group, id="0", mkstream=True)
    except Exception:
        pass

    log.info("resolver_worker.started stream=%s", stream)

    while True:
        try:
            messages = await redis.xreadgroup(
                groupname=consumer_group,
                consumername="resolver-1",
                streams={stream: ">"},
                count=10,
                block=2000,
            )

            for _, stream_messages in (messages or []):
                for msg_id, fields in stream_messages:
                    try:
                        activity = json.loads(fields["data"])
                        enriched = await resolver.resolve_activity(activity)
                        await redis.xadd(
                            settings.STREAM_RESOLVED,
                            {"data": json.dumps(enriched)},
                        )
                        await redis.xack(stream, consumer_group, msg_id)
                        log.debug("resolver.processed activity_id=%s", activity.get("id"))
                    except Exception as e:
                        log.error("resolver.processing_failed msg_id=%s error=%s", msg_id, e)

        except Exception as e:
            log.error("resolver_worker.error error=%s", e)
            await asyncio.sleep(5)


# ── Utility functions ─────────────────────────────────────────────────────────

FREE_EMAIL_PROVIDERS = frozenset([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
    "protonmail.com", "aol.com", "mail.com", "zoho.com", "yandex.com",
])

def _is_free_email_provider(domain: str) -> bool:
    return domain.lower() in FREE_EMAIL_PROVIDERS

def _domain_to_name(domain: str) -> str:
    """'acme-corp.com' → 'Acme Corp', 'techstart.io' → 'Techstart'"""
    name = domain.split(".")[0]
    name = re.sub(r"[-_]", " ", name)
    return name.title()
