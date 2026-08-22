from nexcrm_shared.settings import BaseServiceSettings


class Settings(BaseServiceSettings):
    ANTHROPIC_API_KEY: str = ""
    AI_MODEL: str = "claude-sonnet-4-6"
    AI_FAST_MODEL: str = "claude-haiku-4-5-20251001"   # for extraction tasks
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


settings = Settings()
