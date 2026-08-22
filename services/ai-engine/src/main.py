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

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from nexcrm_shared.bootstrap import configure_app, init_sentry
from nexcrm_shared.health import make_health_router

from .config import settings

init_sentry()

from .routers import extraction, scoring, nl_command, enrichment, forecasting, anomalies  # noqa: E402
from .db import get_pool, close_pool  # noqa: E402

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
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

configure_app(
    app,
    service_name="ai-engine",
    api_gateway_url=settings.API_GATEWAY_URL,
    otlp_endpoint=settings.OTEL_EXPORTER_OTLP_ENDPOINT,
)

app.include_router(make_health_router("ai-engine"))
app.include_router(extraction.router, prefix="/extraction")
app.include_router(scoring.router, prefix="/scoring")
app.include_router(nl_command.router, prefix="/nl")
app.include_router(enrichment.router, prefix="/enrich")
app.include_router(forecasting.router, prefix="/forecast")
app.include_router(anomalies.router)
