from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    REDIS_URL: str = "redis://localhost:6379"
    DATABASE_URL: str = "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm"
    API_GATEWAY_URL: str = "http://localhost:4000"
    AI_ENGINE_URL: str = "http://localhost:5001"
    GRAPH_CORE_URL: str = "http://localhost:4002"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""

    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://localhost:4317"
    LOG_LEVEL: str = "info"

    INTERNAL_SERVICE_SECRET: str = ""
    INTERNAL_SERVICE_SECRET_NEXT: str = ""
    ALLOW_MISSING_SERVICE_TOKEN: str = ""

    # Expected audience for the Gmail Pub/Sub push OIDC token.
    # Should match the audience configured on the Pub/Sub push subscription
    # (typically the public push endpoint URL). When empty, the audience claim
    # is not enforced (but issuer + signature still are).
    GMAIL_PUBSUB_AUDIENCE: str = ""

    # Redis stream names
    STREAM_RAW_SIGNALS: str = "nexcrm:raw-signals"
    STREAM_NORMALIZED: str = "nexcrm:normalized-signals"
    STREAM_RESOLVED: str = "nexcrm:resolved-signals"
    STREAM_CRM_WRITES: str = "nexcrm:crm-writes"
    STREAM_REVIEW_QUEUE: str = "nexcrm:review-queue"

    # Per-tenant cap on auto-created graph nodes (Person/Company) within the
    # rolling window below. Beyond this, candidates are routed to the review
    # queue instead of being auto-created (M-ING2: spoofable-sender protection).
    ENTITY_AUTO_CREATE_LIMIT: int = 200
    ENTITY_AUTO_CREATE_WINDOW_SECONDS: int = 3600

    class Config:
        env_file = "../../.env"
        extra = "ignore"


settings = Settings()
