// Auth types: JWT claims, RBAC, OAuth

export type UserRole = "super_admin" | "admin" | "manager" | "rep" | "read_only";

export interface JWTPayload {
  sub: string;             // user ID
  tenantId: string;
  email: string;
  role: UserRole;
  scopes: string[];
  iat: number;
  exp: number;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: UserRole;
  avatarUrl?: string;
  lastLoginAt?: string;
  createdAt: string;
  /** Per-user feature flags (can_campaigns, can_import, can_export, …) that gate
   *  finer-grained access on top of the role. Used by nav/module visibility. */
  capabilities?: Record<string, boolean>;
  canQuote?: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  plan: "starter" | "growth" | "enterprise";
  dataRegion: "us" | "eu" | "apac";
  settings: TenantSettings;
  parentTenantId?: string | null;
  createdAt: string;
}

// ── Workspace merge types ───────────────────────────────────────────────────

export type MergeStatus = "pending" | "previewing" | "approved" | "in_progress" | "completed" | "failed" | "cancelled";

export interface MergeConflict {
  entityType: "user" | "company" | "contact" | "sequence" | "automation" | "custom_object" | "custom_field";
  sourceRecord: { id: string; label: string; fields: Record<string, unknown> };
  targetRecord: { id: string; label: string; fields: Record<string, unknown> };
  matchKey: string;
  conflictingFields: string[];
}

export interface MergeResolution {
  entityType: string;
  matchKey: string;
  action: "keep_source" | "keep_target" | "merge_fields";
  fieldOverrides?: Record<string, "source" | "target">;
}

export interface WorkspaceMerge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceName?: string;
  targetName?: string;
  initiatedBy: string;
  status: MergeStatus;
  conflicts: MergeConflict[];
  resolutions: MergeResolution[];
  summary?: { moved: number; merged: number; skipped: number };
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

// ── Workspace stats types ───────────────────────────────────────────────────

export interface WorkspaceUsageStats {
  period: string;
  apiCalls: number;
  aiEvents: number;
  aiTokens: number;
  emailsSent: number;
  callsMade: number;
  storageBytes: number;
}

export interface WorkspaceStatsResponse {
  current: WorkspaceUsageStats;
  history: WorkspaceUsageStats[];
  childStats?: Array<{ tenantId: string; tenantName: string; stats: WorkspaceUsageStats }>;
}

export interface TenantSettings {
  aiEnabled: boolean;
  aiMonthlyBudgetEvents: number;
  aiEventsUsedThisMonth: number;
  confidenceThreshold: number;     // 0–1; below this → review queue
  autoApproveThreshold: number;    // 0–1; above this → auto-write
  timezone: string;
  currency: string;
  features: Record<string, boolean>;
}

export interface OAuthToken {
  provider: "google" | "microsoft" | "slack" | "zoom";
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scopes: string[];
  userId: string;
  tenantId: string;
}

// Scope definitions
export const SCOPES = {
  CRM_READ: "crm:read",
  CRM_WRITE: "crm:write",
  AI_READ: "ai:read",
  AI_WRITE: "ai:write",
  ADMIN_READ: "admin:read",
  ADMIN_WRITE: "admin:write",
  INTEGRATIONS_READ: "integrations:read",
  INTEGRATIONS_WRITE: "integrations:write",
} as const;

export const ROLE_SCOPES: Record<UserRole, string[]> = {
  super_admin: Object.values(SCOPES),
  admin: [SCOPES.CRM_READ, SCOPES.CRM_WRITE, SCOPES.AI_READ, SCOPES.AI_WRITE, SCOPES.ADMIN_READ, SCOPES.ADMIN_WRITE],
  manager: [SCOPES.CRM_READ, SCOPES.CRM_WRITE, SCOPES.AI_READ, SCOPES.AI_WRITE, SCOPES.ADMIN_READ],
  rep: [SCOPES.CRM_READ, SCOPES.CRM_WRITE, SCOPES.AI_READ],
  read_only: [SCOPES.CRM_READ],
};
