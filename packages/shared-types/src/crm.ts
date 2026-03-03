// CRM-level view types (built on top of graph nodes for API responses)

import type { DealStage, PersonNode, CompanyNode, DealNode, ActivityNode } from "./graph";

export interface Contact {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  title?: string;
  seniority?: string;
  company?: { id: string; name: string; domain: string };
  influenceScore?: number;
  lastActivityAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  domain: string;
  industry?: string;
  tier?: "smb" | "mid_market" | "enterprise";
  headcount?: number;
  openDeals?: number;
  openDealValue?: number;
  lastActivityAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  tenantId: string;
  name: string;
  stage: DealStage;
  value: number;
  currency: string;
  closeDate?: string;
  /** "simple" (≤2 expected stakeholders, 30d cycle) or "complex" (4 expected, 60d cycle). */
  archetype?: "simple" | "complex";
  /** Is this an expansion into an existing customer? Lowers structural risk. */
  isExpansion?: boolean;
  /** Rep's gut-feel probability (0–100). Compared against realityScore to show Δ. */
  declaredProbability?: number;
  realityScore?: number;
  realityExplanation?: string;
  riskFlags?: string[];
  owner: { id: string; name: string };
  company?: { id: string; name: string };
  buyingGroupSize?: number;
  lastActivityAt?: string;
  daysSinceActivity?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  tenantId: string;
  type: "email" | "call" | "meeting" | "note" | "document";
  subject?: string;
  summary?: string;
  sentiment?: number;
  participants: Contact[];
  deal?: { id: string; name: string };
  company?: { id: string; name: string };
  occurredAt: string;
  autoCapture: boolean;
  createdAt: string;
}

export interface Task {
  id: string;
  tenantId: string;
  title: string;
  dueDate?: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in_progress" | "done";
  assignee: { id: string; name: string };
  relatedTo?: { type: "deal" | "contact" | "company"; id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface Pipeline {
  stages: Array<{
    stage: DealStage;
    deals: Deal[];
    totalValue: number;
    count: number;
  }>;
  totalValue: number;
  totalDeals: number;
  weightedValue: number;  // sum of value × (realityScore / 100)
}

export interface RealityScore {
  score: number;             // 0–100
  trend: "up" | "down" | "flat";
  trendDelta: number;        // change over last 7 days
  explanation: string;       // natural language summary
  factors: Array<{
    name: string;
    weight: number;
    score: number;
    evidence?: string;
  }>;
  lastCalculatedAt: string;
}
