"""
Secret decryption/encryption for the Python services — mirror of the Node
implementations in @nexcrm/service-common (secret-crypto.ts + tenant-crypto.ts).

The Node services store OAuth tokens and other secrets AES-256-GCM encrypted.
Formats in the wild:

  t1:<version>:<iv hex>:<tag hex>:<ct hex>   per-tenant DEK (tenant_encryption_keys)
  <iv hex>:<tag hex>:<ct hex>                shared key, canonical legacy
  <iv b64>:<tag b64>:<ct b64>                shared key, old auth-service format
  base64(iv || ct || tag)                    shared key, old outreach format

maybe_decrypt_secret() additionally tolerates plaintext rows (tokens written by
the ingestion refresh path before it encrypted) by returning the value
unchanged when no format decrypts.
"""

from __future__ import annotations

import base64
import binascii
import os
import time

import asyncpg
import structlog
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

log = structlog.get_logger()

IV_BYTES = 12
TAG_BYTES = 16
_HEX = set("0123456789abcdefABCDEF")


def _kek() -> bytes:
    hexkey = os.environ.get("TENANT_KEK") or os.environ.get("OAUTH_ENCRYPTION_KEY") or ""
    if len(hexkey) != 64:
        raise ValueError("TENANT_KEK (or OAUTH_ENCRYPTION_KEY) must be exactly 64 hex characters")
    return bytes.fromhex(hexkey)


def _gcm_decrypt(key: bytes, iv: bytes, tag: bytes, ct: bytes) -> bytes:
    return AESGCM(key).decrypt(iv, ct + tag, None)


def _gcm_encrypt_hex(key: bytes, plaintext: bytes) -> str:
    iv = os.urandom(IV_BYTES)
    full = AESGCM(key).encrypt(iv, plaintext, None)
    ct, tag = full[:-TAG_BYTES], full[-TAG_BYTES:]
    return f"{iv.hex()}:{tag.hex()}:{ct.hex()}"


def decrypt_legacy(value: str) -> str:
    """Decrypt a shared-key secret in any of the three legacy formats."""
    key = _kek()
    parts = value.split(":")
    if len(parts) == 3:
        iv_s, tag_s, ct_s = parts
        is_hex = len(iv_s) == IV_BYTES * 2 and all(c in _HEX for c in iv_s)
        dec = bytes.fromhex if is_hex else base64.b64decode
        return _gcm_decrypt(key, dec(iv_s), dec(tag_s), dec(ct_s)).decode("utf-8")
    buf = base64.b64decode(value)
    return _gcm_decrypt(key, buf[:IV_BYTES], buf[-TAG_BYTES:], buf[IV_BYTES:-TAG_BYTES]).decode("utf-8")


# ── Per-tenant DEK cache ──────────────────────────────────────────────────────

_dek_cache: dict[str, tuple[bytes, int, float]] = {}
_DEK_TTL = 300.0


async def get_tenant_dek(db: asyncpg.Pool, tenant_id: str) -> tuple[bytes, int]:
    hit = _dek_cache.get(tenant_id)
    if hit and hit[2] > time.monotonic():
        return hit[0], hit[1]

    key = _kek()
    row = await db.fetchrow(
        "SELECT wrapped_dek, key_version FROM tenant_encryption_keys WHERE tenant_id = $1",
        tenant_id,
    )
    if row:
        parts = row["wrapped_dek"].split(":")
        dek = _gcm_decrypt(key, bytes.fromhex(parts[0]), bytes.fromhex(parts[1]), bytes.fromhex(parts[2]))
        version = row["key_version"]
    else:
        dek = os.urandom(32)
        ins = await db.fetchrow(
            """INSERT INTO tenant_encryption_keys (tenant_id, wrapped_dek, key_version)
               VALUES ($1, $2, 1)
               ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
               RETURNING wrapped_dek, key_version""",
            tenant_id, _gcm_encrypt_hex(key, dek),
        )
        parts = ins["wrapped_dek"].split(":")
        dek = _gcm_decrypt(key, bytes.fromhex(parts[0]), bytes.fromhex(parts[1]), bytes.fromhex(parts[2]))
        version = ins["key_version"]

    _dek_cache[tenant_id] = (dek, version, time.monotonic() + _DEK_TTL)
    return dek, version


async def encrypt_tenant_secret(db: asyncpg.Pool, tenant_id: str, plaintext: str) -> str:
    dek, version = await get_tenant_dek(db, tenant_id)
    return f"t1:{version}:{_gcm_encrypt_hex(dek, plaintext.encode('utf-8'))}"


async def decrypt_tenant_secret(db: asyncpg.Pool, tenant_id: str, value: str) -> str:
    if value.startswith("t1:"):
        _, _, iv_s, tag_s, ct_s = value.split(":")
        dek, _v = await get_tenant_dek(db, tenant_id)
        return _gcm_decrypt(dek, bytes.fromhex(iv_s), bytes.fromhex(tag_s), bytes.fromhex(ct_s)).decode("utf-8")
    return decrypt_legacy(value)


async def maybe_decrypt_secret(db: asyncpg.Pool, tenant_id: str, value: str | None) -> str | None:
    """Decrypt if the value matches a known format; return unchanged when it is
    (or appears to be) a plaintext token from before encryption-at-rest."""
    if not value:
        return value
    try:
        return await decrypt_tenant_secret(db, tenant_id, value)
    except (ValueError, KeyError, binascii.Error, Exception):  # noqa: BLE001 — InvalidTag etc.
        log.debug("secret_crypto.plaintext_fallback", tenant_id=tenant_id)
        return value
