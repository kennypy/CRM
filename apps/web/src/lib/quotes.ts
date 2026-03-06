/**
 * Quote-related types and client-side helpers shared across the app.
 */

export type QuoteStatus =
  | "draft"
  | "pending_approval"
  | "sent"
  | "viewed"
  | "accepted"
  | "rejected"
  | "expired";

export interface QuoteItem {
  id?: string;
  productId?: string | null;
  productName: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  discountPct: number;   // 0–100
  lineTotal: number;
  sortOrder?: number;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  title: string;
  status: QuoteStatus;
  approvalRequired: boolean;
  approvedBy?: string | null;
  approvedAt?: string | null;
  dealId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  createdBy: string;
  createdByName?: string;
  companyName?: string;
  contactName?: string;
  currency: string;
  subtotal: number;
  discountType: "none" | "percent" | "fixed";
  discountValue: number;
  taxRate: number;
  total: number;
  notes?: string | null;
  terms?: string | null;
  validUntil?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: QuoteItem[];
}

export interface Product {
  id: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  unitPrice: number;
  currency: string;
  billingCycle: "one_time" | "monthly" | "annual";
  active: boolean;
}

// ── Demo product catalog ──────────────────────────────────────────────────────
export const DEMO_PRODUCTS: Product[] = [
  { id: "prod-001", sku: "CRM-PRO-M",  name: "CRM Pro — Monthly",       description: "Full CRM platform access, per seat per month", unitPrice: 89,    currency: "GBP", billingCycle: "monthly",  active: true },
  { id: "prod-002", sku: "CRM-PRO-A",  name: "CRM Pro — Annual",        description: "Full CRM platform access, per seat per year (2 months free)", unitPrice: 890,   currency: "GBP", billingCycle: "annual",   active: true },
  { id: "prod-003", sku: "CRM-ENT-A",  name: "CRM Enterprise — Annual", description: "Enterprise tier: SSO, priority support, custom integrations, per seat", unitPrice: 1490,  currency: "GBP", billingCycle: "annual",   active: true },
  { id: "prod-004", sku: "IMPL-STD",   name: "Implementation — Standard", description: "Guided onboarding, data migration, up to 2 days on-site", unitPrice: 4500,  currency: "GBP", billingCycle: "one_time", active: true },
  { id: "prod-005", sku: "IMPL-ENT",   name: "Implementation — Enterprise", description: "Full enterprise onboarding, custom configuration, up to 5 days on-site + remote", unitPrice: 12000, currency: "GBP", billingCycle: "one_time", active: true },
  { id: "prod-006", sku: "SUPP-PREM",  name: "Premium Support",          description: "24/7 dedicated support channel, 4-hour SLA, quarterly business review", unitPrice: 250,   currency: "GBP", billingCycle: "monthly",  active: true },
  { id: "prod-007", sku: "TRAIN-HALF", name: "Training — Half Day",      description: "Remote training session, up to 20 users, 4 hours", unitPrice: 1200,  currency: "GBP", billingCycle: "one_time", active: true },
  { id: "prod-008", sku: "API-ADDON",  name: "API Integration Add-on",   description: "Custom API integration build & maintenance, per integration", unitPrice: 2500,  currency: "GBP", billingCycle: "one_time", active: true },
];

// ── Formatting helpers ────────────────────────────────────────────────────────
export function fmtCurrency(val: number, currency = "GBP", locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(val);
}

export function computeLineTotal(qty: number, unitPrice: number, discountPct: number): number {
  return Math.round(qty * unitPrice * (1 - discountPct / 100) * 100) / 100;
}

export function computeQuoteTotals(
  items: Pick<QuoteItem, "quantity" | "unitPrice" | "discountPct">[],
  discountType: "none" | "percent" | "fixed",
  discountValue: number,
  taxRate: number
): { subtotal: number; orderDiscount: number; afterDiscount: number; tax: number; total: number } {
  const subtotal = items.reduce((s, it) => s + computeLineTotal(it.quantity, it.unitPrice, it.discountPct), 0);
  let orderDiscount = 0;
  if (discountType === "percent") orderDiscount = Math.round(subtotal * discountValue / 100 * 100) / 100;
  if (discountType === "fixed")   orderDiscount = Math.min(discountValue, subtotal);
  const afterDiscount = Math.round((subtotal - orderDiscount) * 100) / 100;
  const tax   = Math.round(afterDiscount * taxRate / 100 * 100) / 100;
  const total = afterDiscount + tax;
  return { subtotal, orderDiscount, afterDiscount, tax, total };
}

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft:            "Draft",
  pending_approval: "Pending Approval",
  sent:             "Sent",
  viewed:           "Viewed",
  accepted:         "Accepted",
  rejected:         "Rejected",
  expired:          "Expired",
};

export const STATUS_COLORS: Record<QuoteStatus, string> = {
  draft:            "bg-gray-100 text-gray-600",
  pending_approval: "bg-yellow-100 text-yellow-700",
  sent:             "bg-blue-100 text-blue-700",
  viewed:           "bg-purple-100 text-purple-700",
  accepted:         "bg-green-100 text-green-700",
  rejected:         "bg-red-100 text-red-700",
  expired:          "bg-orange-100 text-orange-700",
};

export const BILLING_CYCLE_LABELS: Record<Product["billingCycle"], string> = {
  one_time: "One-time",
  monthly:  "/ month",
  annual:   "/ year",
};
