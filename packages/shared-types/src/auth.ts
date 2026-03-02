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
}

export interface Tenant {
  id: string;
  name: string;
  domain?: string;
  plan: "starter" | "growth" | "enterprise";
  dataRegion: "us" | "eu" | "apac";
  settings: TenantSettings;
  createdAt: string;
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
