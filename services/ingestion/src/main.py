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

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from nexcrm_shared.bootstrap import configure_app, init_sentry
from nexcrm_shared.health import make_health_router

from .config import settings

init_sentry()

from .routers import gmail, outlook, gcal  # noqa: E402

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

configure_app(
    app,
    service_name="ingestion",
    api_gateway_url=settings.API_GATEWAY_URL,
    otlp_endpoint=settings.OTEL_EXPORTER_OTLP_ENDPOINT,
)

app.include_router(make_health_router("ingestion"))
app.include_router(gmail.router,   prefix="/gmail")
app.include_router(outlook.router, prefix="/outlook")
app.include_router(gcal.router,    prefix="/gcal")
