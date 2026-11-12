/**
 * Lead-to-Quote client types + helpers: lead conversion, assignment rules,
 * web-to-lead forms, approvals, price books, validation rules, deal
 * history/team/splits and standard reports. Mirrors the gateway contract.
 */

import { useEffect, useState } from "react";
import { api } from "./api";

// ── Shared ────────────────────────────────────────────────────────────────────

export interface ApiErrorInfo {
  status: number;
  code: string;
  message: string;
  field?: string;
}

/** Read the `{ success:false, error:{code,message,field?} }` envelope. */
export async function readApiError(res: Response, fallback: string): Promise<ApiErrorInfo> {
  const json = await res.json().catch(() => ({}));
  const err = (json as { error?: { code?: string; message?: string; field?: string } }).error ?? {};
  return {
    status: res.status,
    code: err.code ?? `HTTP_${res.status}`,
    message: err.message ?? fallback,
    field: err.field,
  };
}

/** GET a `{ data }` envelope; throws ApiErrorInfo on failure. */
export async function getData<T>(path: string): Promise<T> {
  const res = await api.get(path);
  if (!res.ok) throw await readApiError(res, `Request failed (${res.status})`);
  const json = await res.json();
  return json.data as T;
}

/** POST/PATCH/PUT a body and return `data`; throws ApiErrorInfo on failure. */
export async function sendData<T>(
  method: "post" | "patch" | "put",
  path: string,
  body: unknown,
): Promise<T> {
  const res = await api[method](path, body);
  if (!res.ok) throw await readApiError(res, `Request failed (${res.status})`);
  const json = await res.json().catch(() => ({}));
  return (json as { data: T }).data;
}

export async function deleteData(path: string): Promise<void> {
  const res = await api.delete(path);
  if (!res.ok && res.status !== 204) throw await readApiError(res, `Request failed (${res.status})`);
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message || fallback;
  }
  return fallback;
}

export interface OrgUser { id: string; firstName: string; lastName: string; email: string; role?: string; }
export interface OrgTeam { id: string; name: string; }

export function userName(u?: Pick<OrgUser, "firstName" | "lastName" | "email"> | null): string {
  if (!u) return "—";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
}

/** Workspace users for pickers. Silently empty on failure. */
export function useOrgUsers(): OrgUser[] {
  const [users, setUsers] = useState<OrgUser[]>([]);
  useEffect(() => {
    let alive = true;
    api.get("/api/v1/users")
      .then(async (r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => { if (alive) setUsers(j.data ?? j.users ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return users;
}

export function useOrgTeams(): OrgTeam[] {
  const [teams, setTeams] = useState<OrgTeam[]>([]);
  useEffect(() => {
    let alive = true;
    api.get("/api/v1/teams")
      .then(async (r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => { if (alive) setTeams(j.data ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return teams;
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export const CONVERT_DEAL_STAGES = ["lead", "qualified", "discovery", "proposal", "negotiation"] as const;
export type ConvertDealStage = (typeof CONVERT_DEAL_STAGES)[number];

export interface ConvertLeadRequest {
  companyId?: string;
  companyName?: string;
  companyDomain?: string;
  createDeal: boolean;
  dealName?: string;
  dealValue?: number;
  dealCloseDate?: string;
  dealStage?: ConvertDealStage;
  ownerId?: string;
}

export interface ConvertLeadResult {
  contactId: string;
  companyId: string;
  companyCreated: boolean;
  dealId: string | null;
  conversionId: string;
}

export interface AssignLeadResult { assignedTo: string | null; ruleId: string | null; }

export const ASSIGNMENT_FIELDS = ["source", "country", "title", "seniority", "email", "companyName"] as const;
export const ASSIGNMENT_OPS = ["eq", "neq", "contains", "in", "starts_with", "exists"] as const;
export type AssignmentOp = (typeof ASSIGNMENT_OPS)[number];

export interface AssignmentCondition {
  field: string; // one of ASSIGNMENT_FIELDS or "customFields.<key>"
  op: AssignmentOp;
  value?: string | string[];
}

export interface AssignmentRule {
  id: string;
  name: string;
  priority: number;
  active: boolean;
  conditions: AssignmentCondition[];
  assignToType: "user" | "team_round_robin";
  assignToId: string;
}

export interface WebToLeadForm {
  id: string;
  name: string;
  formKey: string;
  allowedOrigins: string[];
  defaultSource: string;
  active: boolean;
  createdAt: string;
}

/** Public base URL of the API gateway (web-to-lead posts go straight there, not through Next). */
export function gatewayPublicUrl(): string {
  const env = process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function webToLeadUrl(formKey: string): string {
  return `${gatewayPublicUrl()}/public/web-to-lead/${encodeURIComponent(formKey)}`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Copy-paste HTML snippet for embedding a web-to-lead form on a customer site. */
export function webToLeadSnippet(formKey: string): string {
  const action = escAttr(webToLeadUrl(formKey));
  return [
    `<form action="${action}" method="POST">`,
    `  <input name="firstName" placeholder="First name" required>`,
    `  <input name="lastName" placeholder="Last name" required>`,
    `  <input name="email" type="email" placeholder="Email" required>`,
    `  <input name="company" placeholder="Company">`,
    `  <input name="title" placeholder="Job title">`,
    `  <input name="phone" type="tel" placeholder="Phone">`,
    `  <!-- Spam trap: must stay empty and hidden -->`,
    `  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">`,
    `  <button type="submit">Submit</button>`,
    `</form>`,
  ].join("\n");
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected" | "recalled";
export type ApprovalStepStatus = "pending" | "approved" | "rejected" | "skipped";

export interface ApprovalStep {
  stepNumber: number;
  approverId: string;
  approverName: string;
  status: ApprovalStepStatus;
  comment: string | null;
  actedAt: string | null;
}

export interface ApprovalRequest {
  id: string;
  entityType: "quote";
  entityId: string;
  entityLabel: string;
  status: ApprovalStatus;
  submittedBy: string;
  submittedByName: string;
  submittedAt: string;
  currentStep: number;
  steps: ApprovalStep[];
  reason: string | null;
}

export const APPROVAL_STATUS_COLORS: Record<ApprovalStatus, string> = {
  pending:  "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  recalled: "bg-gray-100 text-gray-600",
};

// ── Quotes ────────────────────────────────────────────────────────────────────

/**
 * Download the server-rendered quote PDF. Goes through the authenticated
 * same-origin proxy (HttpOnly cookie) and saves the blob — a bare <a href>
 * would also work for cookies, but this lets us surface API errors inline.
 */
export async function downloadQuotePdf(quoteId: string, filename: string): Promise<void> {
  const res = await api.get(`/api/v1/quotes/${quoteId}/pdf`);
  if (!res.ok) throw await readApiError(res, "Failed to generate PDF");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

// ── Price books ───────────────────────────────────────────────────────────────

export interface PriceBook {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  isStandard: boolean;
  active: boolean;
}

export interface PriceBookEntry {
  id?: string;
  productId: string;
  productName: string;
  unitPrice: number;
  active: boolean;
}

// ── Validation rules ──────────────────────────────────────────────────────────

export const VR_ENTITIES = ["contact", "company", "deal", "quote"] as const;
export type VrEntity = (typeof VR_ENTITIES)[number];
export const VR_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "is_blank", "is_not_blank", "changed"] as const;
export type VrOp = (typeof VR_OPS)[number];
export const VR_UNARY_OPS: ReadonlySet<VrOp> = new Set<VrOp>(["is_blank", "is_not_blank", "changed"]);

export interface VrLeaf { field: string; op: VrOp; value?: unknown; }
export type VrCondition =
  | VrLeaf
  | { all: VrCondition[] }
  | { any: VrCondition[] }
  | { not: VrCondition };

export interface ValidationRule {
  id: string;
  entityType: VrEntity;
  name: string;
  active: boolean;
  condition: VrCondition;
  errorMessage: string;
  errorField?: string | null;
}

/**
 * If `cond` is a flat `{all|any: [leaf…]}` (or a single leaf), return it in
 * flat-editor form; otherwise null (the rule must be edited as raw JSON).
 */
export function toFlatCondition(cond: VrCondition | null | undefined): { mode: "all" | "any"; leaves: VrLeaf[] } | null {
  if (!cond) return { mode: "all", leaves: [] };
  const isLeaf = (c: VrCondition): c is VrLeaf => typeof c === "object" && c !== null && "field" in c && "op" in c;
  if (isLeaf(cond)) return { mode: "all", leaves: [cond] };
  if ("all" in cond && Array.isArray(cond.all) && cond.all.every(isLeaf)) return { mode: "all", leaves: cond.all as VrLeaf[] };
  if ("any" in cond && Array.isArray(cond.any) && cond.any.every(isLeaf)) return { mode: "any", leaves: cond.any as VrLeaf[] };
  return null;
}

export function fromFlatCondition(mode: "all" | "any", leaves: VrLeaf[]): VrCondition {
  return mode === "all" ? { all: leaves } : { any: leaves };
}

/** Coerce the free-text editor value into the type the operator expects. */
export function coerceVrValue(op: VrOp, raw: string): unknown {
  if (VR_UNARY_OPS.has(op)) return undefined;
  if (op === "in") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (["gt", "gte", "lt", "lte"].includes(op)) {
    const n = Number(raw);
    return raw.trim() !== "" && !Number.isNaN(n) ? n : raw;
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

export function vrValueToText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

// ── Deals ─────────────────────────────────────────────────────────────────────

export interface DealHistoryEntry {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
}

export const DEAL_TEAM_ROLES = ["owner", "sales_engineer", "executive_sponsor", "overlay", "other"] as const;
export type DealTeamRole = (typeof DEAL_TEAM_ROLES)[number];

export interface DealTeamMember {
  userId: string;
  userName?: string;
  role: DealTeamRole;
  access: "read" | "write";
}

export interface DealSplit {
  userId: string;
  userName?: string;
  splitType: "revenue" | "overlay";
  percent: number;
}

export function revenueSplitTotal(splits: DealSplit[]): number {
  return Math.round(splits.filter((s) => s.splitType === "revenue").reduce((s, x) => s + (Number(x.percent) || 0), 0) * 100) / 100;
}

export type DealScope = "mine" | "team" | "all";

// ── Standard reports ──────────────────────────────────────────────────────────

export interface StandardReportDef { key: string; name: string; description: string; }
export interface StandardReportColumn { key: string; label: string; type: string; }
export interface StandardReportResult { columns: StandardReportColumn[]; rows: Record<string, unknown>[]; }

export function formatReportCell(value: unknown, type: string, locale?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  switch (type) {
    case "currency":
      return Number.isFinite(n) ? n.toLocaleString(locale, { maximumFractionDigits: 0 }) : String(value);
    case "percent":
      // Accept either a 0–1 ratio or a 0–100 percentage.
      return Number.isFinite(n) ? `${(n <= 1 && n >= 0 ? n * 100 : n).toFixed(1)}%` : String(value);
    case "number":
    case "integer":
      return Number.isFinite(n) ? n.toLocaleString(locale, { maximumFractionDigits: 2 }) : String(value);
    case "duration_hours":
      return Number.isFinite(n) ? `${n.toFixed(1)} h` : String(value);
    case "duration_days":
      return Number.isFinite(n) ? `${n.toFixed(1)} d` : String(value);
    case "date":
    case "datetime": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(locale);
    }
    default:
      return String(value);
  }
}
