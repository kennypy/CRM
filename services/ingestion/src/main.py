"""
NexCRM Ingestion Service
========================
Manages OAuth connections and raw signal ingestion from:
  - Gmail (Google OAuth watch)
  - Outlook (Microsoft Graph webhooks)
  - Google Calendar
  - Zoom (webhook receiver)
  - Slack (Events API)

Each inbound event is normalized to a canonical ActivityEvent and
published to Redis Streams for downstream processing by workers.
"""

import os
from contextlib import asynccontextmanager
import structlog
import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings

# Only initialize Sentry when a DSN is configured. The `enabled` option was
# removed from sentry-sdk, so passing it raises TypeError on init and crashes
# the service on boot — guard on the DSN instead (no DSN → Sentry stays off).
_sentry_dsn = os.getenv("SENTRY_DSN")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=os.getenv("NODE_ENV", "development"),
        traces_sample_rate=0.1 if os.getenv("NODE_ENV") == "production" else 0.0,
    )
from .routers import gmail, outlook, gcal, health  # noqa: E402
from .telemetry import setup_telemetry  # noqa: E402

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("ingestion_service.starting", version="0.1.0")
    # This process serves the HTTP webhook/OAuth endpoints only. The async
    # pipeline consumers (normalizer, resolver, persisters, crm-writer) run in a
    # separate `ingestion-worker` process — see src/worker.py and the
    # ingestion-worker service in docker-compose.yml.
    yield
    log.info("ingestion_service.stopping")


app = FastAPI(
    title="NexCRM Ingestion Service",
    description="Zero-entry signal ingestion pipeline",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.API_GATEWAY_URL],
    allow_methods=["*"],
    allow_headers=["*"],
)

from .middleware.service_token import ServiceTokenMiddleware  # noqa: E402
app.add_middleware(ServiceTokenMiddleware)

# Instrument at import time — newer Starlette forbids add_middleware (which OTEL
# instrument_app does under the hood) once the app has started, so this must run
# before the lifespan startup, not inside it.
setup_telemetry(app)

app.include_router(health.router)
app.include_router(gmail.router,   prefix="/gmail")
app.include_router(outlook.router, prefix="/outlook")
app.include_router(gcal.router,    prefix="/gcal")
