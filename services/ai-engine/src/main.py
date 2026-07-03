"""
NexCRM AI Engine
================
Handles all LLM-based intelligence:
  - Structured extraction from emails/transcripts (zero-entry pipeline)
  - Entity resolution via embedding similarity
  - Reality Score calculation
  - Natural language command processing (streaming)
  - Lead scoring
  - Anomaly detection
  - Smart email composition suggestions
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
from .routers import extraction, scoring, nl_command, health, enrichment, forecasting, anomalies  # noqa: E402
from .telemetry import setup_telemetry  # noqa: E402
from .db import get_pool, close_pool  # noqa: E402

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_telemetry(app)
    log.info("ai_engine.starting")
    await get_pool()   # warm up DB connection pool
    yield
    await close_pool()
    log.info("ai_engine.stopping")


app = FastAPI(
    title="NexCRM AI Engine",
    description="LLM-based intelligence: extraction, scoring, NL interface",
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

app.include_router(health.router)
app.include_router(extraction.router, prefix="/extraction")
app.include_router(scoring.router, prefix="/scoring")
app.include_router(nl_command.router, prefix="/nl")
app.include_router(enrichment.router, prefix="/enrich")
app.include_router(forecasting.router, prefix="/forecast")
app.include_router(anomalies.router)
