// CRM-level view types (built on top of graph nodes for API responses)

import type { DealStage, PersonNode, CompanyNode, DealNode, ActivityNode } from "./graph";

export type LeadSource = "organic" | "paid_search" | "paid_social" | "referral" | "event" | "cold_outreach" | "partner" | "content" | "webinar" | "other";
export type LifecycleStage = "subscriber" | "lead" | "mql" | "sql" | "opportunity" | "customer" | "evangelist";
export type LeadStatus = "new" | "open" | "in_progress" | "unqualified" | "attempted" | "connected" | "nurture";

export type CampaignType = "email" | "social" | "event" | "webinar" | "content" | "paid_search" | "paid_social" | "abm" | "referral" | "other";
export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed" | "archived";
export type CampaignChannel = "email" | "linkedin" | "facebook" | "google" | "twitter" | "instagram" | "webinar" | "event" | "sms" | "direct_mail" | "other";

export interface Contact {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  title?: string;
  phone?: string;
  seniority?: string;
  isLead?: boolean;
  source?: string;
  company?: { id: string; name: string; domain: string };
  influenceScore?: number;
  lastActivityAt?: string;
  dealMemberships?: unknown[];
  // Marketing fields
  leadSource?: LeadSource;
  lifecycleStage?: LifecycleStage;
  leadStatus?: LeadStatus;
  marketingQualifiedDate?: string;
  salesQualifiedDate?: string;
  lastCampaignId?: string;
  lastCampaignName?: string;
  lastCampaignDate?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  firstTouchChannel?: string;
  lastTouchChannel?: string;
  engagementScore?: number;
  createdAt: string;
  updatedAt: string;
}

export type MarketingTier = "tier_1" | "tier_2" | "tier_3";

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
  // Marketing fields
  marketingTier?: MarketingTier;
  isTargetAccount?: boolean;
  lastCampaignId?: string;
  lastCampaignName?: string;
  lastCampaignDate?: string;
  totalCampaignTouches?: number;
  accountScore?: number;
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
  ownerId?: string;
  owner?: { id: string; name: string };
  company?: { id: string; name: string };
  buyingGroupSize?: number;
  lastActivityAt?: string;
  daysSinceActivity?: number;
  // Marketing fields
  primaryCampaignId?: string;
  primaryCampaignName?: string;
  marketingSourced?: boolean;
  marketingInfluenced?: boolean;
  influencedCampaigns?: string[];
  campaignROI?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: CampaignType;
  status: CampaignStatus;
  channel?: CampaignChannel;
  startDate?: string;
  endDate?: string;
  budget?: number;
  actualSpend?: number;
  currency: string;
  targetAudience?: string;
  goals?: string;
  ownerId?: string;
  owner?: { id: string; name: string };
  // Metrics
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  unsubscribed: number;
  bounced: number;
  leadsGenerated: number;
  mqls: number;
  sqls: number;
  opportunities: number;
  closedWon: number;
  revenue: number;
  // Meta
  tags: string[];
  contactCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  tenantId: string;
  type: "email" | "call" | "meeting" | "note" | "document";
  direction?: "inbound" | "outbound" | "internal" | null;
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
