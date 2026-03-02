// API request/response envelope types

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    processingMs: number;
  };
}

export interface FilterOperator {
  eq?: unknown;
  neq?: unknown;
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  contains?: string;
  in?: unknown[];
  isNull?: boolean;
}

export interface SortParam {
  field: string;
  direction: "asc" | "desc";
}

// Common filter shapes
export interface ContactFilter {
  search?: string;
  companyId?: string;
  dealId?: string;
  seniority?: string[];
  lastActivityBefore?: string;
  lastActivityAfter?: string;
}

export interface DealFilter {
  search?: string;
  stage?: string[];
  ownerId?: string;
  companyId?: string;
  closeDateBefore?: string;
  closeDateAfter?: string;
  minValue?: number;
  maxValue?: number;
  minRealityScore?: number;
  maxRealityScore?: number;
  atRisk?: boolean;
}

export interface ActivityFilter {
  type?: string[];
  contactId?: string;
  dealId?: string;
  companyId?: string;
  occurredAfter?: string;
  occurredBefore?: string;
  autoCapture?: boolean;
}
