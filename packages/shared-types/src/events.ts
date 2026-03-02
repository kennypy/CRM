// CRM event types for the event stream / Redis Streams

export type CRMEventType =
  // Ingestion
  | "email.received"
  | "email.sent"
  | "calendar.event_created"
  | "calendar.event_updated"
  | "call.started"
  | "call.ended"
  | "meeting.transcript_ready"
  | "slack.message_received"
  // AI Pipeline
  | "extraction.started"
  | "extraction.completed"
  | "extraction.failed"
  | "review_queue.item_added"
  | "review_queue.item_approved"
  | "review_queue.item_rejected"
  // CRM Writes
  | "contact.created"
  | "contact.updated"
  | "contact.merged"
  | "company.created"
  | "company.updated"
  | "deal.created"
  | "deal.updated"
  | "deal.stage_changed"
  | "deal.closed_won"
  | "deal.closed_lost"
  | "activity.created"
  | "signal.detected"
  | "reality_score.updated"
  // User Actions
  | "user.logged_in"
  | "task.created"
  | "task.completed"
  | "workflow.triggered"
  | "workflow.completed";

export interface CRMEvent {
  id: string;
  tenantId: string;
  eventType: CRMEventType;
  source: string;
  actorId?: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  metadata?: {
    confidence?: number;
    modelUsed?: string;
    evidence?: string;
    correlationId?: string;
  };
  createdAt: string;
}

// Redis Streams stream names
export const STREAMS = {
  RAW_SIGNALS: "nexcrm:raw-signals",
  NORMALIZED_SIGNALS: "nexcrm:normalized-signals",
  RESOLVED_SIGNALS: "nexcrm:resolved-signals",
  EXTRACTED_SIGNALS: "nexcrm:extracted-signals",
  CRM_WRITES: "nexcrm:crm-writes",
  REVIEW_QUEUE: "nexcrm:review-queue",
  NOTIFICATIONS: "nexcrm:notifications",
} as const;
