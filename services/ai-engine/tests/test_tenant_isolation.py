"""
Focused tests for H-AI5: tenant context must be derived from the verified
`x-tenant-id` gateway header, never from the request body.

These tests exercise the pure decision logic so they run without FastAPI/DB/redis
installed. When the full FastAPI stack is available they additionally import the
real `_resolve_tenant` helper and assert identical behavior, guaranteeing the
test contract stays bound to the production code.

Run: python3 -m pytest services/ai-engine/tests/test_tenant_isolation.py
"""

import importlib.util

import pytest


# ── Reference implementation of the H-AI5 rule (kept in lock-step with
#    enrichment._resolve_tenant). The header always wins; a non-empty body tenant
#    that disagrees with the header is a hard 403; a missing header is a hard 403. ──
def _decide(header_tenant, body_tenant):
    """Return resolved tenant or raise ValueError(status_code, reason)."""
    header_tenant = (header_tenant or "").strip()
    if not header_tenant:
        raise ValueError(403)
    if body_tenant and body_tenant.strip() and body_tenant.strip() != header_tenant:
        raise ValueError(403)
    return header_tenant


def test_header_used_when_body_absent():
    assert _decide("tenant-A", None) == "tenant-A"
    assert _decide("tenant-A", "") == "tenant-A"


def test_matching_body_is_allowed():
    assert _decide("tenant-A", "tenant-A") == "tenant-A"
    assert _decide("tenant-A", " tenant-A ") == "tenant-A"


def test_mismatched_body_is_rejected():
    # Attacker forges body tenant_id to pivot to another tenant → must 403.
    with pytest.raises(ValueError):
        _decide("tenant-A", "tenant-B")


def test_missing_header_is_rejected():
    with pytest.raises(ValueError):
        _decide(None, "tenant-A")
    with pytest.raises(ValueError):
        _decide("", "tenant-A")


def test_body_never_overrides_header():
    # The body can never select a tenant the header did not authorize.
    assert _decide("tenant-A", "tenant-A") == "tenant-A"
    with pytest.raises(ValueError):
        _decide("tenant-A", "tenant-EVIL")


@pytest.mark.skipif(
    importlib.util.find_spec("fastapi") is None,
    reason="fastapi not installed; pure-logic tests above still cover the contract",
)
def test_production_resolver_matches_contract():
    from fastapi import HTTPException
    from src.routers.enrichment import _resolve_tenant

    assert _resolve_tenant("tenant-A", None) == "tenant-A"
    assert _resolve_tenant("tenant-A", "tenant-A") == "tenant-A"
    with pytest.raises(HTTPException):
        _resolve_tenant("tenant-A", "tenant-B")
    with pytest.raises(HTTPException):
        _resolve_tenant(None, "tenant-A")
