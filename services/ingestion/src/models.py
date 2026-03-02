"""
Canonical event schemas for the ingestion pipeline.
All raw signals are normalized to these schemas before processing.
"""

from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field
import uuid


class RawSignalEvent(BaseModel):
    """Published to nexcrm:raw-signals immediately on receipt."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    user_id: str                          # the NexCRM user who owns the integration
    source: Literal["gmail", "outlook", "gcal", "zoom", "slack", "dialer"]
    source_event_id: str                  # external message/event ID for deduplication
    raw_payload: dict[str, Any]
    received_at: datetime = Field(default_factory=datetime.utcnow)


class ActivityEvent(BaseModel):
    """
    Normalized canonical activity — output of the normalizer worker.
    Published to nexcrm:normalized-signals.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    user_id: str
    source: str
    source_event_id: str
    activity_type: Literal["email", "call", "meeting", "document", "chat"]

    # Participants
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    to_emails: list[str] = Field(default_factory=list)
    cc_emails: list[str] = Field(default_factory=list)
    participant_emails: list[str] = Field(default_factory=list)  # for meetings

    # Content
    subject: Optional[str] = None
    body_text: Optional[str] = None        # plain text, stripped of HTML
    body_html: Optional[str] = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)

    # Timing
    occurred_at: datetime
    duration_seconds: Optional[int] = None  # calls/meetings

    # Metadata
    thread_id: Optional[str] = None
    meeting_url: Optional[str] = None
    recording_url: Optional[str] = None

    normalized_at: datetime = Field(default_factory=datetime.utcnow)


class EntityResolutionResult(BaseModel):
    """Output of entity resolver — maps emails to Person/Company node IDs."""
    activity_event_id: str
    resolved_persons: list[dict[str, Any]]   # [{email, node_id, is_new, confidence}]
    resolved_companies: list[dict[str, Any]] # [{domain, node_id, is_new, confidence}]
    resolution_confidence: float             # overall confidence 0–1
