"""
Service-token validation middleware for FastAPI services.

Uses hmac.compare_digest for constant-time comparison to prevent timing attacks.
Supports dual-token rotation via INTERNAL_SERVICE_SECRET_NEXT.
"""

import hmac
import os

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

log = structlog.get_logger()

PUBLIC_PATHS = frozenset({"/health"})


def _is_valid_token(token: str) -> bool:
    current = os.environ.get("INTERNAL_SERVICE_SECRET", "")
    if current and hmac.compare_digest(token, current):
        return True
    next_secret = os.environ.get("INTERNAL_SERVICE_SECRET_NEXT", "")
    if next_secret and hmac.compare_digest(token, next_secret):
        return True
    return False


class ServiceTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path.rstrip("/")
        if path in PUBLIC_PATHS:
            return await call_next(request)

        secret = os.environ.get("INTERNAL_SERVICE_SECRET", "")
        if not secret:
            if os.environ.get("ALLOW_MISSING_SERVICE_TOKEN") == "true":
                return await call_next(request)
            log.error("service_token.not_configured")
            return JSONResponse(
                status_code=503,
                content={
                    "success": False,
                    "error": {
                        "code": "SERVICE_UNAVAILABLE",
                        "message": "Service token not configured",
                    },
                },
            )

        token = request.headers.get("x-service-token", "")
        if not token or not _is_valid_token(token):
            log.warning("service_token.rejected", client=request.client.host if request.client else "unknown")
            return JSONResponse(
                status_code=403,
                content={
                    "success": False,
                    "error": {
                        "code": "FORBIDDEN",
                        "message": "Invalid or missing service token",
                    },
                },
            )

        return await call_next(request)
