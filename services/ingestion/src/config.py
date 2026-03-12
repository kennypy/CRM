from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    REDIS_URL: str = "redis://localhost:6379"
    DATABASE_URL: str = "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm"
    API_GATEWAY_URL: str = "http://localhost:4000"
    AI_ENGINE_URL: str = "http://localhost:5001"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""

    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://localhost:4317"
    LOG_LEVEL: str = "info"

    INTERNAL_SERVICE_SECRET: str = ""
    INTERNAL_SERVICE_SECRET_NEXT: str = ""
    ALLOW_MISSING_SERVICE_TOKEN: str = ""

    # Redis stream names
    STREAM_RAW_SIGNALS: str = "nexcrm:raw-signals"
    STREAM_NORMALIZED: str = "nexcrm:normalized-signals"

    class Config:
        env_file = "../../.env"
        extra = "ignore"


settings = Settings()
