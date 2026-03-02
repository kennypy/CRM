// Graph node and edge type definitions

export type NodeLabel =
  | "Person"
  | "Company"
  | "Deal"
  | "BuyingGroup"
  | "Activity"
  | "Signal"
  | "Project"
  | "Task"
  | "Tag"
  | "Tenant";

export type EdgeLabel =
  | "WORKS_AT"
  | "KNOWS"
  | "INFLUENCES"
  | "PART_OF"
  | "INVOLVED_IN"
  | "PARTICIPATED_IN"
  | "GENERATED"
  | "OWNS"
  | "CHILD_OF"
  | "TAGGED_WITH";

export interface GraphNode {
  id: string;
  tenantId: string;
  label: NodeLabel;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface GraphEdge {
  id: string;
  tenantId: string;
  label: EdgeLabel;
  fromId: string;
  toId: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Provenance {
  source: string;          // 'gmail' | 'zoom' | 'user' | 'ai_engine' | 'enrichment'
  sourceId?: string;       // message ID, event ID, etc.
  extractedBy?: string;    // model name if AI-generated
  confidence: number;      // 0–1
  evidence?: string;       // excerpt that justified this write
  modelVersion?: string;
}

// ── Person node ──────────────────────────────────────────────────────────────
export interface PersonNode extends GraphNode {
  label: "Person";
  properties: {
    firstName: string;
    lastName: string;
    email: string;
    emails?: string[];
    phone?: string;
    title?: string;
    seniority?: "individual_contributor" | "manager" | "director" | "vp" | "c_suite" | "founder";
    linkedinUrl?: string;
    avatarUrl?: string;
    influenceScore?: number;  // 0–100, derived
    sentimentScore?: number;  // -1 to 1, derived from communications
    provenance?: Provenance;
  };
}

// ── Company node ──────────────────────────────────────────────────────────────
export interface CompanyNode extends GraphNode {
  label: "Company";
  properties: {
    name: string;
    domain: string;
    industry?: string;
    headcount?: number;
    revenue?: number;
    tier?: "smb" | "mid_market" | "enterprise";
    website?: string;
    linkedinUrl?: string;
    logoUrl?: string;
    country?: string;
    provenance?: Provenance;
  };
}

// ── Deal node ──────────────────────────────────────────────────────────────
export type DealStage =
  | "lead"
  | "qualified"
  | "discovery"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

export interface DealNode extends GraphNode {
  label: "Deal";
  properties: {
    name: string;
    stage: DealStage;
    value: number;
    currency: string;
    closeDate?: string;
    realityScore?: number;    // 0–100, AI-derived
    realityExplanation?: string;
    riskFlags?: string[];
    ownerId: string;
    competitorsMentioned?: string[];
    provenance?: Provenance;
  };
}

// ── Activity node ─────────────────────────────────────────────────────────────
export type ActivityType = "email" | "call" | "meeting" | "note" | "document";

export interface ActivityNode extends GraphNode {
  label: "Activity";
  properties: {
    type: ActivityType;
    subject?: string;
    summary?: string;          // AI-generated summary
    sentiment?: number;        // -1 to 1
    duration?: number;         // seconds (calls/meetings)
    externalId?: string;       // gmail message ID, zoom meeting ID
    occurredAt: string;
    provenance?: Provenance;
  };
}

// ── Signal node ─────────────────────────────────────────────────────────────
export type SignalType =
  | "intent"
  | "product_usage"
  | "web_visit"
  | "objection"
  | "buying_signal"
  | "churn_risk";

export interface SignalNode extends GraphNode {
  label: "Signal";
  properties: {
    type: SignalType;
    score: number;             // signal strength 0–100
    topic?: string;
    source: string;
    occurredAt: string;
    provenance?: Provenance;
  };
}
