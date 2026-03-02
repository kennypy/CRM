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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import settings
from .routers import extraction, scoring, nl_command, health
from .workers.extraction_worker import start_extraction_worker
from .telemetry import setup_telemetry

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_telemetry()
    log.info("ai_engine.starting")
    yield
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

app.include_router(health.router)
app.include_router(extraction.router, prefix="/extraction")
app.include_router(scoring.router, prefix="/scoring")
app.include_router(nl_command.router, prefix="/nl")
