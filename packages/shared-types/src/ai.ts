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

export interface PredictiveForecast {
  dealId: string;
  predictedCloseProbability: number;  // 0–100
  predictedCloseDate?: string;
  predictedValue?: number;
  confidenceIntervalLow?: number;
  confidenceIntervalHigh?: number;
  factors: Array<{
    name: string;
    impact: number;
    evidence: string;
  }>;
  modelVersion: string;
  calculatedAt: string;
}

export type AnomalySeverity = "low" | "medium" | "high" | "critical";
export type AnomalyStatus = "open" | "acknowledged" | "resolved" | "dismissed";
export type AnomalyAlertType =
  | "stalled_deal"
  | "at_risk_account"
  | "engagement_drop"
  | "champion_left"
  | "competitor_mention"
  | "budget_cut_signal"
  | "unusual_activity"
  | "ghost_deal";

export interface AnomalyAlert {
  id: string;
  entityType: "deal" | "contact" | "company";
  entityId: string;
  alertType: AnomalyAlertType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  evidence: Array<{ label: string; detail: string }>;
  status: AnomalyStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  createdAt: string;
}

export type MarketplaceCategory =
  | "communication"
  | "productivity"
  | "analytics"
  | "data_enrichment"
  | "marketing"
  | "support"
  | "finance"
  | "custom";

export interface MarketplaceApp {
  id: string;
  slug: string;
  name: string;
  description: string;
  shortDescription?: string;
  iconUrl?: string;
  publisher: string;
  category: MarketplaceCategory;
  authType: "oauth2" | "api_key" | "webhook" | "none";
  version: string;
  isInstalled: boolean;
  installId?: string;
}

export interface MarketplaceInstall {
  id: string;
  appId: string;
  appName: string;
  appSlug: string;
  status: "active" | "paused" | "error" | "uninstalled";
  config: Record<string, unknown>;
  lastSyncedAt?: string;
  createdAt: string;
}
