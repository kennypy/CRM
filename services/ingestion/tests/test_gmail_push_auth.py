"""
Unit tests for the C2 Gmail Pub/Sub OIDC verification logic.

verify_oauth2_token is monkeypatched so no network/Google certs are needed.
"""

import sys
import types

import pytest

from src.routers import gmail as gmail_router


def _install_fake_google(monkeypatch, *, claims=None, raises=False):
    """Install a fake google.oauth2.id_token + google.auth.transport.requests."""
    id_token_mod = types.ModuleType("google.oauth2.id_token")

    def verify_oauth2_token(token, request, audience=None):
        if raises:
            raise ValueError("bad token")
        return claims or {}

    id_token_mod.verify_oauth2_token = verify_oauth2_token

    oauth2_pkg = types.ModuleType("google.oauth2")
    oauth2_pkg.id_token = id_token_mod

    transport_requests = types.ModuleType("google.auth.transport.requests")
    transport_requests.Request = lambda: object()
    auth_transport = types.ModuleType("google.auth.transport")
    auth_transport.requests = transport_requests
    auth_pkg = types.ModuleType("google.auth")
    auth_pkg.transport = auth_transport
    google_pkg = types.ModuleType("google")
    google_pkg.oauth2 = oauth2_pkg
    google_pkg.auth = auth_pkg

    monkeypatch.setitem(sys.modules, "google", google_pkg)
    monkeypatch.setitem(sys.modules, "google.oauth2", oauth2_pkg)
    monkeypatch.setitem(sys.modules, "google.oauth2.id_token", id_token_mod)
    monkeypatch.setitem(sys.modules, "google.auth", auth_pkg)
    monkeypatch.setitem(sys.modules, "google.auth.transport", auth_transport)
    monkeypatch.setitem(sys.modules, "google.auth.transport.requests", transport_requests)


def test_rejects_missing_header():
    assert gmail_router._verify_pubsub_jwt(None) is False
    assert gmail_router._verify_pubsub_jwt("Basic abc") is False
    assert gmail_router._verify_pubsub_jwt("Bearer ") is False


def test_rejects_bad_issuer(monkeypatch):
    _install_fake_google(monkeypatch, claims={"iss": "https://evil.example"})
    assert gmail_router._verify_pubsub_jwt("Bearer tok") is False


def test_rejects_invalid_signature(monkeypatch):
    _install_fake_google(monkeypatch, raises=True)
    assert gmail_router._verify_pubsub_jwt("Bearer tok") is False


def test_accepts_valid_google_token(monkeypatch):
    _install_fake_google(monkeypatch, claims={"iss": "https://accounts.google.com"})
    assert gmail_router._verify_pubsub_jwt("Bearer tok") is True


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-q"]))
