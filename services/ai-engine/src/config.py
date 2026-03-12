from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ANTHROPIC_API_KEY: str = ""
    AI_MODEL: str = "claude-sonnet-4-6"
    AI_FAST_MODEL: str = "claude-haiku-4-5-20251001"   # for extraction tasks
    AI_MAX_TOKENS: int = 8192
    AI_CONFIDENCE_THRESHOLD: float = 0.75              # below → review queue
    AI_AUTO_APPROVE_THRESHOLD: float = 0.90            # above → auto-write

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
