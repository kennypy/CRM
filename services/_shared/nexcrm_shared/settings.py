"""
Base settings shared by the Python services.

Holds every field that was previously declared (with identical defaults) in both
services/ingestion/src/config.py and services/ai-engine/src/config.py — most
importantly the Redis stream names, which are the cross-service contract of the
ingestion pipeline. Each service subclasses this with only its own fields.
"""

from pydantic_settings import BaseSettings


class BaseServiceSettings(BaseSettings):
    REDIS_URL: str = "redis://localhost:6379"
    DATABASE_URL: str = "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm"
    API_GATEWAY_URL: str = "http://localhost:4000"
    GRAPH_CORE_URL: str = "http://localhost:4002"

    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://localhost:4317"

    # Shared secret for service-to-service calls (see service_token middleware).
    INTERNAL_SERVICE_SECRET: str = ""

    # Redis stream names shared across the pipeline (cross-service contract:
    # ingestion produces, ai-engine consumes, and both write review/crm streams).
    STREAM_NORMALIZED: str = "nexcrm:normalized-signals"
    STREAM_CRM_WRITES: str = "nexcrm:crm-writes"
    STREAM_REVIEW_QUEUE: str = "nexcrm:review-queue"

    class Config:
        env_file = "../../.env"
        extra = "ignore"
