from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ANTHROPIC_API_KEY: str = ""
    AI_MODEL: str = "claude-sonnet-4-6"
    AI_FAST_MODEL: str = "claude-haiku-4-5-20251001"   # for extraction tasks
    AI_MAX_TOKENS: int = 8192
    AI_CONFIDENCE_THRESHOLD: float = 0.75              # below → review queue
    AI_AUTO_APPROVE_THRESHOLD: float = 0.90            # above → auto-write (trusted sources only)

    # C1 hardening: model-reported confidence is NOT authoritative and must never
    # gate an unattended write of content derived from untrusted external input
    # (inbound email/webhook bodies are attacker-controllable → prompt injection).
    #
    # Auto-write is therefore DISABLED by default. Even when enabled it only applies
    # to extractions whose `source` is in AI_TRUSTED_SOURCES; everything else is
    # routed to the human review queue regardless of confidence.
    AI_ALLOW_AUTO_WRITE: bool = False
    # Comma-separated list of activity `source` values considered internal/trusted
    # enough to take the auto-write fast-path (only honoured when AI_ALLOW_AUTO_WRITE).
    AI_TRUSTED_SOURCES: str = "internal"

    REDIS_URL: str = "redis://localhost:6379"
    DATABASE_URL: str = "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm"
    API_GATEWAY_URL: str = "http://localhost:4000"

    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://localhost:4317"
    LOG_LEVEL: str = "info"

    STREAM_NORMALIZED: str = "nexcrm:normalized-signals"
    STREAM_EXTRACTED: str = "nexcrm:extracted-signals"
    STREAM_REVIEW_QUEUE: str = "nexcrm:review-queue"
    STREAM_CRM_WRITES: str = "nexcrm:crm-writes"

    INTERNAL_SERVICE_SECRET: str = ""
    INTERNAL_SERVICE_SECRET_NEXT: str = ""
    ALLOW_MISSING_SERVICE_TOKEN: str = ""

    class Config:
        env_file = "../../.env"
        extra = "ignore"


settings = Settings()
