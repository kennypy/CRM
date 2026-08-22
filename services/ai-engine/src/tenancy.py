"""
H-AI5: single implementation of the tenant-context rule for every router.

The tenant is derived strictly from the gateway-provided `x-tenant-id` header.
The gateway sets this header from the verified JWT (see api-gateway/src/lib/
proxy.ts) and never accepts it from clients, so it is the authoritative tenant
context. A tenant_id in the request body or query string is attacker-
controllable and MUST NOT be trusted: if present it must match the header,
otherwise we reject with 403 to prevent cross-tenant reads/write-backs.
"""

import structlog
from fastapi import HTTPException

log = structlog.get_logger()


def resolve_tenant(header_tenant: str | None, claimed_tenant: str | None = None) -> str:
    """Return the authoritative tenant id, or raise 403.

    `claimed_tenant` is a body/query tenant id accepted only so we can 403 on a
    mismatch with the verified header; the header always wins.
    """
    header_tenant = (header_tenant or "").strip()
    if not header_tenant:
        raise HTTPException(status_code=403, detail="Tenant context missing")
    if claimed_tenant and claimed_tenant.strip() and claimed_tenant.strip() != header_tenant:
        log.warning(
            "tenancy.tenant_mismatch",
            header_tenant=header_tenant,
            claimed_tenant=claimed_tenant,
        )
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    return header_tenant
