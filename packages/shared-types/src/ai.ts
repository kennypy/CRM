// AI Engine types: extraction, scoring, review queue

export type ExtractionStatus = "pending" | "extracted" | "failed" | "skipped";
export type ReviewStatus = "pending" | "approved" | "rejected" | "auto_approved";

export interface ExtractionResult {
  id: string;
  sourceType: "email" | "calendar" | "transcript" | "document" | "slack";
  sourceId: string;
  status: ExtractionStatus;
  confidence: number;        // 0–1
  extractedEntities: ExtractedEntity[];
  extractedRelationships: ExtractedRelationship[];
  extractedSignals: ExtractedSignal[];
  rawText?: string;
  modelUsed: string;
  processingMs: number;
  createdAt: string;
}

export interface ExtractedEntity {
  type: "person" | "company" | "deal" | "task" | "project";
  matchedNodeId?: string;    // if matched to existing node
  isNew: boolean;
  confidence: number;
  fields: Record<string, { value: unknown; confidence: number; evidence: string }>;
}

export interface ExtractedRelationship {
  type: string;              // edge label
  fromEntityIdx: number;
  toEntityIdx: number;
  confidence: number;
  properties: Record<string, unknown>;
  evidence: string;
}

export interface ExtractedSignal {
  type: string;
  score: number;
  topic?: string;
  evidence: string;
  confidence: number;
}

export interface ReviewQueueItem {
  id: string;
  tenantId: string;
  extractionId: string;
  status: ReviewStatus;
  confidence: number;
  summary: string;           // human-readable description of what AI wants to write
  proposedChanges: ProposedChange[];
  evidence: string;          // source excerpt
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface ProposedChange {
  operation: "create" | "update";
  entityType: string;
  entityId?: string;         // if updating existing
  field: string;
  currentValue?: unknown;
  proposedValue: unknown;
  confidence: number;
  evidence: string;
}

export interface NLCommandRequest {
  command: string;
  context?: {
    currentPage?: string;
    selectedEntityId?: string;
    selectedEntityType?: string;
  };
}

export interface NLCommandResult {
  intent: "query" | "create" | "update" | "navigate" | "unknown";
  response: string;
  actions?: Array<{
    type: string;
    label: string;
    payload: Record<string, unknown>;
  }>;
  queryResults?: unknown[];
  requiresConfirmation: boolean;
}

export interface LeadScore {
  contactId: string;
  score: number;             // 0–100
  tier: "hot" | "warm" | "cold";
  factors: Array<{
    name: string;
    impact: number;          // positive or negative contribution
    evidence: string;
  }>;
  calculatedAt: string;
}
