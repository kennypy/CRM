from nexcrm_shared.settings import BaseServiceSettings


class Settings(BaseServiceSettings):
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""

    # Expected audience for the Gmail Pub/Sub push OIDC token.
    # Should match the audience configured on the Pub/Sub push subscription
    # (typically the public push endpoint URL). When empty, the audience claim
    # is not enforced (but issuer + signature still are).
    GMAIL_PUBSUB_AUDIENCE: str = ""

    # Streams only this service produces/consumes (the cross-service ones live
    # in BaseServiceSettings).
    STREAM_RAW_SIGNALS: str = "nexcrm:raw-signals"
    STREAM_RESOLVED: str = "nexcrm:resolved-signals"

    # Per-tenant cap on auto-created graph nodes (Person/Company) within the
    # rolling window below. Beyond this, candidates are routed to the review
    # queue instead of being auto-created (M-ING2: spoofable-sender protection).
    ENTITY_AUTO_CREATE_LIMIT: int = 200
    ENTITY_AUTO_CREATE_WINDOW_SECONDS: int = 3600


settings = Settings()
