/**
 * Admin Reports routes — gated to admin + super_admin roles.
 *
 * GET  /api/v1/admin-reports/types              — list available admin report types
 * POST /api/v1/admin-reports/run                — execute an admin report
 * POST /api/v1/admin-reports/feature-usage      — record a feature usage event
 *
 * Super-admin-only reports:
 *   - users_paid_vs_used       — seats paid for vs. actually used per workspace
 *   - users_last_active        — all users across workspaces with last login
 *   - features_active_used     — which features are enabled vs. actually used across workspaces
 *
 * Admin reports (workspace-scoped):
 *   - field_usage              — which fields are filled in, how often
 *   - workspace_users_active   — users in this workspace, last active date
 *   - role_feature_usage       — feature usage broken down by role
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { servicePool as pool, servicePool as readPool } from "../db";
import { requireMinRole } from "../middleware/rbac";
import { denyApiKeys } from "../middleware/scope";

const SUPER_ADMIN_REPORTS = [
  { key: "users_paid_vs_used",   label: "Users: Paid vs Used",            description: "Seats paid for vs active users per workspace" },
  { key: "users_last_active",    label: "Users: Last Active",             description: "All users across all workspaces with last login date" },
  { key: "features_active_used", label: "Features: Active / Used / Not Used", description: "Feature flags enabled vs actually used across all workspaces" },
];

const ADMIN_REPORTS = [
  { key: "field_usage",            label: "Field Usage",           description: "Which record fields are populated and how often" },
  { key: "workspace_users_active", label: "Users: Last Active",    description: "Users in this workspace with last login date" },
  { key: "role_feature_usage",     label: "Per-Role Feature Usage", description: "Feature usage broken down by role (sequences, quotes, etc.)" },
];

// Known CRM features to track
const KNOWN_FEATURES = [
  "sequences", "quotes", "deals", "contacts", "companies",
  "activities", "ai", "custom_fields", "custom_objects",
  "import", "export", "bulk_actions", "workflows", "outreach",
  "reports", "integrations", "api_keys",
];

export async function adminReportsRoutes(server: FastifyInstance) {
  // All routes require admin or above; block API keys
  server.addHook("preHandler", requireMinRole("admin"));
  server.addHook("preHandler", denyApiKeys);

  /** GET /admin-reports/types — list available report types based on role */
  server.get("/types", async (request, reply) => {
    const role = request.user.role;
    const types = role === "super_admin"
      ? [...SUPER_ADMIN_REPORTS, ...ADMIN_REPORTS]
      : [...ADMIN_REPORTS];
    return reply.send({ success: true, data: types });
  });

  /** POST /admin-reports/run — execute an admin report */
  server.post("/run", async (request, reply) => {
    const schema = z.object({
      reportType: z.string().min(1),
      tenantId: z.string().uuid().optional(), // for super_admin cross-tenant reports
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    const { reportType } = body.data;
    const role = request.user.role;
    const callerTenantId = request.user.tenantId;

    // Gate super_admin reports
    const isSuperReport = SUPER_ADMIN_REPORTS.some(r => r.key === reportType);
    if (isSuperReport && role !== "super_admin") {
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "This report requires super_admin access" },
      });
    }

    // Determine effective tenant for admin-scoped reports
    const effectiveTenant = role === "super_admin" && body.data.tenantId
      ? body.data.tenantId
      : callerTenantId;

    try {
      const data = await runAdminReport(reportType, effectiveTenant, role);
      return reply.send({ success: true, data });
    } catch (err: any) {
      server.log.error({ err: err.message, reportType }, "admin_report.run_failed");
      return reply.status(500).send({
        success: false,
        error: { code: "REPORT_ERROR", message: err.message },
      });
    }
  });

  /** POST /admin-reports/feature-usage — record a feature usage event */
  server.post("/feature-usage", async (request, reply) => {
    const schema = z.object({
      feature: z.string().min(1),
      action: z.string().min(1).default("use"),
      metadata: z.record(z.unknown()).optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: body.error.issues[0].message },
      });
    }

    try {
      await pool.query(
        `INSERT INTO feature_usage_log (tenant_id, user_id, feature, action, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [request.user.tenantId, request.user.sub, body.data.feature, body.data.action, JSON.stringify(body.data.metadata ?? {})]
      );
    } catch {
      // Non-critical — don't fail the response
    }

    return reply.send({ success: true });
  });
}

// ── Report execution ──────────────────────────────────────────────────────────

async function runAdminReport(
  reportType: string,
  tenantId: string,
  role: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number }> {
  switch (reportType) {
    case "users_paid_vs_used":
      return runUsersPaidVsUsed();
    case "users_last_active":
      return runUsersLastActive(role === "super_admin" ? undefined : tenantId);
    case "features_active_used":
      return runFeaturesActiveUsed();
    case "field_usage":
      return runFieldUsage(tenantId);
    case "workspace_users_active":
      return runWorkspaceUsersActive(tenantId);
    case "role_feature_usage":
      return runRoleFeatureUsage(tenantId);
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
}

/**
 * Super admin: seats paid for (based on plan) vs active users per workspace.
 */
async function runUsersPaidVsUsed() {
  const { rows } = await readPool.query(`
    SELECT
      t.id AS "workspaceId",
      t.name AS "workspaceName",
      t.slug,
      t.plan,
      CASE t.plan
        WHEN 'starter'    THEN 5
        WHEN 'growth'     THEN 25
        WHEN 'enterprise' THEN 999
        ELSE 5
      END AS "seatsPaid",
      COUNT(u.id) FILTER (WHERE u.deleted_at IS NULL) AS "totalUsers",
      COUNT(u.id) FILTER (WHERE u.deleted_at IS NULL AND u.last_login_at > NOW() - INTERVAL '30 days') AS "activeUsers30d",
      COUNT(u.id) FILTER (WHERE u.deleted_at IS NULL AND u.last_login_at > NOW() - INTERVAL '7 days') AS "activeUsers7d"
    FROM tenants t
    LEFT JOIN users u ON u.tenant_id = t.id
    WHERE t.deleted_at IS NULL AND t.slug != '_platform'
    GROUP BY t.id, t.name, t.slug, t.plan
    ORDER BY t.name
  `);

  return {
    columns: ["workspaceName", "slug", "plan", "seatsPaid", "totalUsers", "activeUsers30d", "activeUsers7d"],
    rows: rows.map((r: any) => ({
      ...r,
      seatsPaid: Number(r.seatsPaid),
      totalUsers: Number(r.totalUsers),
      activeUsers30d: Number(r.activeUsers30d),
      activeUsers7d: Number(r.activeUsers7d),
    })),
    rowCount: rows.length,
  };
}

/**
 * Users last active — all users or workspace-scoped.
 */
async function runUsersLastActive(tenantId?: string) {
  const where = tenantId
    ? `WHERE u.deleted_at IS NULL AND u.tenant_id = $1`
    : `WHERE u.deleted_at IS NULL AND t.slug != '_platform'`;
  const params = tenantId ? [tenantId] : [];

  const { rows } = await readPool.query(`
    SELECT
      u.id AS "userId",
      u.first_name || ' ' || u.last_name AS "fullName",
      u.email,
      u.role,
      t.name AS "workspaceName",
      t.slug AS "workspaceSlug",
      u.last_login_at AS "lastLoginAt",
      u.created_at AS "createdAt",
      CASE
        WHEN u.last_login_at > NOW() - INTERVAL '7 days' THEN 'active'
        WHEN u.last_login_at > NOW() - INTERVAL '30 days' THEN 'idle'
        WHEN u.last_login_at IS NOT NULL THEN 'inactive'
        ELSE 'never_logged_in'
      END AS "status"
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    ${where}
    ORDER BY u.last_login_at DESC NULLS LAST
  `, params);

  return {
    columns: ["fullName", "email", "role", "workspaceName", "lastLoginAt", "status"],
    rows,
    rowCount: rows.length,
  };
}

/**
 * Super admin: features enabled vs actually used across all workspaces.
 */
async function runFeaturesActiveUsed() {
  // Get all tenants with their feature flags
  const { rows: tenants } = await readPool.query(`
    SELECT id, name, slug, settings
    FROM tenants
    WHERE deleted_at IS NULL AND slug != '_platform'
    ORDER BY name
  `);

  // Get feature usage counts from the last 30 days
  let usageCounts: Record<string, number> = {};
  try {
    const { rows: usage } = await readPool.query(`
      SELECT feature, COUNT(DISTINCT tenant_id) AS workspace_count
      FROM feature_usage_log
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY feature
    `);
    for (const u of usage) {
      usageCounts[u.feature] = Number(u.workspace_count);
    }
  } catch {
    // Table may not exist yet
  }

  // Also check actual data presence as a proxy for feature "used"
  const dataChecks = await Promise.all([
    readPool.query(`SELECT tenant_id, COUNT(*) AS c FROM activities WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY tenant_id`).then(r => ({ feature: "activities", tenants: r.rows.map((x: any) => x.tenant_id) })).catch(() => ({ feature: "activities", tenants: [] })),
    readPool.query(`SELECT DISTINCT tenant_id FROM quotes WHERE created_at > NOW() - INTERVAL '30 days'`).then(r => ({ feature: "quotes", tenants: r.rows.map((x: any) => x.tenant_id) })).catch(() => ({ feature: "quotes", tenants: [] })),
  ]);

  const dataUsage: Record<string, string[]> = {};
  for (const dc of dataChecks) {
    dataUsage[dc.feature] = dc.tenants;
  }

  const rows: Record<string, unknown>[] = [];

  for (const feature of KNOWN_FEATURES) {
    const enabledCount = tenants.filter((t: any) => {
      const settings = t.settings ?? {};
      const features = settings.features ?? {};
      return features[feature] === true || features[feature] === undefined; // default-on features
    }).length;

    const usedCount = usageCounts[feature] ?? (dataUsage[feature]?.length ?? 0);

    rows.push({
      feature,
      enabledWorkspaces: enabledCount,
      usedWorkspaces: usedCount,
      notUsedWorkspaces: Math.max(0, enabledCount - usedCount),
      totalWorkspaces: tenants.length,
      adoptionRate: tenants.length > 0
        ? `${Math.round((usedCount / tenants.length) * 100)}%`
        : "0%",
    });
  }

  return {
    columns: ["feature", "enabledWorkspaces", "usedWorkspaces", "notUsedWorkspaces", "adoptionRate"],
    rows,
    rowCount: rows.length,
  };
}

/**
 * Admin: field usage — which contact/company/deal fields are actually populated.
 */
async function runFieldUsage(tenantId: string) {
  const rows: Record<string, unknown>[] = [];

  // Check contact fields via graph-core or direct query
  const contactFields = ["email", "title", "seniority"];
  for (const field of contactFields) {
    try {
      const { rows: [r] } = await readPool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE properties->>'${field}' IS NOT NULL AND properties->>'${field}' != '') AS filled
        FROM ag_catalog.cypher('nexcrm_graph', $$
          MATCH (c:Contact {tenant_id: '${tenantId}'}) RETURN properties(c) AS properties
        $$) AS (properties agtype)
      `);
      rows.push({
        entity: "contacts",
        field,
        totalRecords: Number(r?.total ?? 0),
        filledRecords: Number(r?.filled ?? 0),
        fillRate: r?.total > 0 ? `${Math.round((r.filled / r.total) * 100)}%` : "0%",
      });
    } catch {
      // Graph not available — try SQL approach for known tables
    }
  }

  // Check company fields
  const companyFields = ["domain", "industry", "country", "revenue", "employees"];
  for (const field of companyFields) {
    try {
      const { rows: [r] } = await readPool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE properties->>'${field}' IS NOT NULL AND properties->>'${field}' != '') AS filled
        FROM ag_catalog.cypher('nexcrm_graph', $$
          MATCH (c:Company {tenant_id: '${tenantId}'}) RETURN properties(c) AS properties
        $$) AS (properties agtype)
      `);
      rows.push({
        entity: "companies",
        field,
        totalRecords: Number(r?.total ?? 0),
        filledRecords: Number(r?.filled ?? 0),
        fillRate: r?.total > 0 ? `${Math.round((r.filled / r.total) * 100)}%` : "0%",
      });
    } catch {
      // Graph not available
    }
  }

  // Check deal fields from graph
  const dealFields = ["value", "close_date", "stage", "company_id"];
  for (const field of dealFields) {
    try {
      const { rows: [r] } = await readPool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE properties->>'${field}' IS NOT NULL AND properties->>'${field}' != '') AS filled
        FROM ag_catalog.cypher('nexcrm_graph', $$
          MATCH (d:Deal {tenant_id: '${tenantId}'}) RETURN properties(d) AS properties
        $$) AS (properties agtype)
      `);
      rows.push({
        entity: "deals",
        field,
        totalRecords: Number(r?.total ?? 0),
        filledRecords: Number(r?.filled ?? 0),
        fillRate: r?.total > 0 ? `${Math.round((r.filled / r.total) * 100)}%` : "0%",
      });
    } catch {
      // Graph not available
    }
  }

  // Check user fields (SQL)
  const userFields = ["phone", "country", "timezone", "avatar_url"];
  for (const field of userFields) {
    try {
      const { rows: [r] } = await readPool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE ${field} IS NOT NULL AND ${field} != '') AS filled
        FROM users
        WHERE tenant_id = $1 AND deleted_at IS NULL
      `, [tenantId]);
      rows.push({
        entity: "users",
        field,
        totalRecords: Number(r?.total ?? 0),
        filledRecords: Number(r?.filled ?? 0),
        fillRate: r?.total > 0 ? `${Math.round((Number(r.filled) / Number(r.total)) * 100)}%` : "0%",
      });
    } catch {
      // Skip
    }
  }

  // If no graph data available, return empty with message
  if (rows.length === 0) {
    // Fallback: at least report user fields
    const userFieldsFallback = ["phone", "country", "timezone", "avatar_url"];
    for (const field of userFieldsFallback) {
      try {
        const { rows: [r] } = await readPool.query(`
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE ${field} IS NOT NULL AND ${field} != '') AS filled
          FROM users
          WHERE tenant_id = $1 AND deleted_at IS NULL
        `, [tenantId]);
        rows.push({
          entity: "users",
          field,
          totalRecords: Number(r?.total ?? 0),
          filledRecords: Number(r?.filled ?? 0),
          fillRate: r?.total > 0 ? `${Math.round((Number(r.filled) / Number(r.total)) * 100)}%` : "0%",
        });
      } catch {
        // Skip
      }
    }
  }

  return {
    columns: ["entity", "field", "totalRecords", "filledRecords", "fillRate"],
    rows,
    rowCount: rows.length,
  };
}

/**
 * Admin: workspace users with last active date.
 */
async function runWorkspaceUsersActive(tenantId: string) {
  return runUsersLastActive(tenantId);
}

/**
 * Admin: feature usage broken down by role.
 */
async function runRoleFeatureUsage(tenantId: string) {
  // Get users grouped by role
  const { rows: roleUsers } = await readPool.query(`
    SELECT role, COUNT(*) AS user_count
    FROM users
    WHERE tenant_id = $1 AND deleted_at IS NULL
    GROUP BY role
    ORDER BY role
  `, [tenantId]);

  // Get feature usage from log, grouped by role
  let featureByRole: any[] = [];
  try {
    const { rows } = await readPool.query(`
      SELECT
        u.role,
        fl.feature,
        COUNT(*) AS usage_count,
        COUNT(DISTINCT fl.user_id) AS unique_users
      FROM feature_usage_log fl
      JOIN users u ON u.id = fl.user_id
      WHERE fl.tenant_id = $1 AND fl.created_at > NOW() - INTERVAL '30 days'
      GROUP BY u.role, fl.feature
      ORDER BY u.role, fl.feature
    `, [tenantId]);
    featureByRole = rows;
  } catch {
    // Table may not exist yet
  }

  // Also check actual data creation as proxy for feature usage
  const featureProxies: { feature: string; query: string }[] = [
    { feature: "sequences", query: `SELECT u.role, COUNT(*) AS c FROM users u JOIN sequences s ON s.created_by = u.id WHERE u.tenant_id = $1 AND u.deleted_at IS NULL GROUP BY u.role` },
    { feature: "quotes", query: `SELECT u.role, COUNT(*) AS c FROM users u JOIN quotes q ON q.created_by = u.id WHERE u.tenant_id = $1 AND u.deleted_at IS NULL GROUP BY u.role` },
    { feature: "activities", query: `SELECT u.role, COUNT(*) AS c FROM users u JOIN activities a ON a.created_by = u.id WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND a.created_at > NOW() - INTERVAL '30 days' GROUP BY u.role` },
  ];

  const proxyData: Record<string, Record<string, number>> = {};
  for (const fp of featureProxies) {
    try {
      const { rows } = await readPool.query(fp.query, [tenantId]);
      proxyData[fp.feature] = {};
      for (const r of rows) {
        proxyData[fp.feature][r.role] = Number(r.c);
      }
    } catch {
      // Table may not exist
    }
  }

  // Build result rows: one per role × feature
  const roles = roleUsers.map((r: any) => r.role);
  const features = [...new Set([
    ...KNOWN_FEATURES.filter(f => ["sequences", "quotes", "activities", "deals", "contacts", "companies", "reports", "ai", "workflows", "import", "export"].includes(f)),
    ...featureByRole.map((r: any) => r.feature),
  ])];

  const rows: Record<string, unknown>[] = [];
  for (const role of roles) {
    const roleRow = roleUsers.find((r: any) => r.role === role);
    for (const feature of features) {
      const logEntry = featureByRole.find((r: any) => r.role === role && r.feature === feature);
      const proxyCount = proxyData[feature]?.[role] ?? 0;
      const usageCount = logEntry ? Number(logEntry.usage_count) : proxyCount;
      const uniqueUsers = logEntry ? Number(logEntry.unique_users) : (proxyCount > 0 ? 1 : 0);

      rows.push({
        role,
        userCount: Number(roleRow?.user_count ?? 0),
        feature,
        usageCount,
        uniqueUsers,
        adoptionRate: Number(roleRow?.user_count) > 0
          ? `${Math.round((uniqueUsers / Number(roleRow.user_count)) * 100)}%`
          : "0%",
      });
    }
  }

  return {
    columns: ["role", "userCount", "feature", "usageCount", "uniqueUsers", "adoptionRate"],
    rows,
    rowCount: rows.length,
  };
}
