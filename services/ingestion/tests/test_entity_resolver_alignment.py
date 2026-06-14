"""
Unit tests for the M-ING2 sender-alignment gate in the entity resolver.

These exercise the pure decision logic (_sender_is_aligned) plus the
auto-create vs review-queue routing of EntityResolver with the DB/redis
dependencies stubbed out, so no live Postgres/Redis is required.
"""

import asyncio

import pytest

from src.workers import entity_resolver as er


# ── _sender_is_aligned ────────────────────────────────────────────────────────

def test_aligned_when_all_string_flags_pass():
    activity = {"auth_results": {"spf": "pass", "dkim": "pass", "dmarc": "pass"}}
    assert er._sender_is_aligned(activity) is True


def test_not_aligned_when_any_flag_fails():
    activity = {"auth_results": {"spf": "pass", "dkim": "fail", "dmarc": "pass"}}
    assert er._sender_is_aligned(activity) is False


def test_aligned_with_bool_flags():
    activity = {"spf_pass": True, "dkim_pass": True, "dmarc_pass": True}
    assert er._sender_is_aligned(activity) is True


def test_none_when_no_signals_present():
    activity = {"from_email": "a@b.com"}
    assert er._sender_is_aligned(activity) is None


# ── EntityResolver routing ────────────────────────────────────────────────────

class _FakeDB:
    """Minimal asyncpg.Pool stand-in. fetchrow always misses (forces create path)."""

    def __init__(self):
        self.review_rows = []

    async def fetchrow(self, *args, **kwargs):
        return None

    async def execute(self, query, *args):
        if "INSERT INTO review_queue" in query:
            self.review_rows.append(args)


class _FakeRedis:
    def __init__(self):
        self.xadds = []
        self.counts = {}

    async def xadd(self, stream, fields):
        self.xadds.append((stream, fields))

    async def incr(self, key):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key, ttl):
        return True


def _make_resolver():
    return er.EntityResolver(_FakeDB(), _FakeRedis())


def test_unaligned_sender_is_not_created_and_is_reviewed():
    resolver = _make_resolver()
    # Sender present but no auth signals -> alignment unknown -> must NOT create.
    activity = {
        "tenant_id": "t1",
        "from_email": "ceo@acme-corp.com",
        "to_emails": [],
        "cc_emails": [],
        "participant_emails": [],
    }
    result = asyncio.get_event_loop().run_until_complete(
        resolver.resolve_activity(activity)
    )
    person = result["resolved_persons"]["ceo@acme-corp.com"]
    assert person["is_new"] is False
    assert person["match_type"] == "review_unaligned"
    assert person["confidence"] < er.CREATE_THRESHOLD
    # No graph create write was emitted, and a review row was enqueued.
    assert resolver.redis.xadds == []
    assert resolver.db.review_rows  # at least one review entry


def test_aligned_sender_is_auto_created():
    resolver = _make_resolver()
    activity = {
        "tenant_id": "t1",
        "from_email": "ceo@acme-corp.com",
        "auth_results": {"spf": "pass", "dkim": "pass", "dmarc": "pass"},
        "to_emails": [],
        "cc_emails": [],
        "participant_emails": [],
    }
    result = asyncio.get_event_loop().run_until_complete(
        resolver.resolve_activity(activity)
    )
    person = result["resolved_persons"]["ceo@acme-corp.com"]
    assert person["is_new"] is True
    assert person["match_type"] == "created"
    # A create_node write was emitted to the CRM-writes stream.
    assert any("create_node" in fields["data"] for _, fields in resolver.redis.xadds)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-q"]))
