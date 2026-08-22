"""
Shared FastAPI service bootstrap: Sentry guard + CORS + service-token middleware
+ OTel instrumentation. Both Python services previously carried verbatim copies
of this wiring in their main.py.
"""

import os

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .service_token import ServiceTokenMiddleware
from .telemetry import setup_telemetry


def init_sentry() -> None:
    # Only initialize Sentry when a DSN is configured. The `enabled` option was
    # removed from sentry-sdk, so passing it raises TypeError on init and crashes
    # the service on boot — guard on the DSN instead (no DSN → Sentry stays off).
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            environment=os.getenv("NODE_ENV", "development"),
            traces_sample_rate=0.1 if os.getenv("NODE_ENV") == "production" else 0.0,
        )


def configure_app(
    app: FastAPI,
    *,
    service_name: str,
    api_gateway_url: str,
    otlp_endpoint: str,
) -> None:
    """Apply the standard middleware stack. Must run at import time — newer
    Starlette forbids add_middleware (which OTel instrument_app does under the
    hood) once the app has started."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[api_gateway_url],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Added after CORS so it runs first (outermost).
    app.add_middleware(ServiceTokenMiddleware)
    setup_telemetry(app, service_name=service_name, endpoint=otlp_endpoint)
