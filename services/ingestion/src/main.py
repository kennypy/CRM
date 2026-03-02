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
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import gmail, outlook, health
from .workers.normalizer import start_normalizer_workers
from .telemetry import setup_telemetry

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_telemetry()
    log.info("ingestion_service.starting", version="0.1.0")
    # Workers are started via Celery separately; this service handles HTTP
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

app.include_router(health.router)
app.include_router(gmail.router, prefix="/gmail")
app.include_router(outlook.router, prefix="/outlook")
