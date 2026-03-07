"use client";

import { useState, useEffect } from "react";
import {
  BarChart3,
  Users,
  Layers,
  Activity,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ReportType {
  key: string;
  label: string;
  description: string;
}

interface ReportResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

const REPORT_ICONS: Record<string, typeof Users> = {
  users_paid_vs_used: Users,
  users_last_active: Users,
  features_active_used: Layers,
  field_usage: BarChart3,
  workspace_users_active: Users,
  role_feature_usage: Activity,
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  idle: "bg-yellow-100 text-yellow-700",
  inactive: "bg-red-100 text-red-700",
  never_logged_in: "bg-gray-100 text-gray-500",
};

export default function AdminReportsPage() {
  const [reportTypes, setReportTypes] = useState<ReportType[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [typesLoading, setTypesLoading] = useState(true);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get("/api/v1/admin-reports/types").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setReportTypes(data.data ?? []);
      }
    }).catch(() => {}).finally(() => setTypesLoading(false));
  }, []);

  const runReport = async (reportType: string) => {
    setSelectedReport(reportType);
    setResult(null);
    setLoading(true);
    setSortColumn(null);

    try {
      const res = await api.post("/api/v1/admin-reports/run", { reportType });
      if (res.ok) {
        const data = await res.json();
        setResult(data.data ?? null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
  };

  const sortedRows = result?.rows ? [...result.rows].sort((a, b) => {
    if (!sortColumn) return 0;
    const av = a[sortColumn];
    const bv = b[sortColumn];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  }) : [];

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const selectedType = reportTypes.find(r => r.key === selectedReport);

  // Group reports by category
  const superAdminReports = reportTypes.filter(r =>
    ["users_paid_vs_used", "users_last_active", "features_active_used"].includes(r.key)
  );
  const adminReports = reportTypes.filter(r =>
    ["field_usage", "workspace_users_active", "role_feature_usage"].includes(r.key)
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Usage analytics and workspace intelligence
        </p>
      </div>

      {typesLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {/* Sidebar: report types */}
          <div className="space-y-4">
            {superAdminReports.length > 0 && (
              <div>
                <button
                  onClick={() => toggleGroup("super")}
                  className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2"
                >
                  {expandedGroups.has("super") ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Platform Reports
                </button>
                {!expandedGroups.has("super") && (
                  <div className="space-y-1">
                    {superAdminReports.map((rt) => {
                      const Icon = REPORT_ICONS[rt.key] ?? BarChart3;
                      return (
                        <button
                          key={rt.key}
                          onClick={() => runReport(rt.key)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                            selectedReport === rt.key
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted text-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-medium text-sm">{rt.label}</p>
                            <p className="text-xs text-muted-foreground">{rt.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {adminReports.length > 0 && (
              <div>
                <button
                  onClick={() => toggleGroup("admin")}
                  className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2"
                >
                  {expandedGroups.has("admin") ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Workspace Reports
                </button>
                {!expandedGroups.has("admin") && (
                  <div className="space-y-1">
                    {adminReports.map((rt) => {
                      const Icon = REPORT_ICONS[rt.key] ?? BarChart3;
                      return (
                        <button
                          key={rt.key}
                          onClick={() => runReport(rt.key)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                            selectedReport === rt.key
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted text-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-medium text-sm">{rt.label}</p>
                            <p className="text-xs text-muted-foreground">{rt.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Main: report results */}
          <div className="lg:col-span-3">
            {!selectedReport && (
              <div className="flex flex-col items-center justify-center rounded-xl border bg-card p-12 text-center">
                <BarChart3 className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Select a report from the sidebar to get started
                </p>
              </div>
            )}

            {selectedReport && loading && (
              <div className="flex items-center justify-center rounded-xl border bg-card p-12">
                <p className="text-sm text-muted-foreground">Running report...</p>
              </div>
            )}

            {selectedReport && !loading && result && (
              <div className="rounded-xl border bg-card">
                <div className="flex items-center justify-between border-b px-5 py-4">
                  <div>
                    <h2 className="font-semibold">{selectedType?.label}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>

                {result.rowCount === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    No data available for this report
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          {result.columns.map((col) => (
                            <th
                              key={col}
                              className="px-4 py-2.5 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => handleSort(col)}
                            >
                              <span className="inline-flex items-center gap-1">
                                {formatColumnName(col)}
                                <ArrowUpDown className="h-3 w-3 opacity-40" />
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {sortedRows.map((row, i) => (
                          <tr key={i} className="hover:bg-muted/20 transition-colors">
                            {result.columns.map((col) => (
                              <td key={col} className="px-4 py-2.5 whitespace-nowrap">
                                {renderCell(col, row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatColumnName(col: string): string {
  return col
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function renderCell(col: string, value: unknown): React.ReactNode {
  if (value == null) return <span className="text-muted-foreground">-</span>;

  // Status badges
  if (col === "status" && typeof value === "string" && STATUS_COLORS[value]) {
    return (
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[value])}>
        {value.replace(/_/g, " ")}
      </span>
    );
  }

  // Role badges
  if (col === "role" && typeof value === "string") {
    return (
      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        {value.replace(/_/g, " ")}
      </span>
    );
  }

  // Plan badges
  if (col === "plan" && typeof value === "string") {
    const planColors: Record<string, string> = {
      starter: "bg-gray-100 text-gray-700",
      growth: "bg-blue-100 text-blue-700",
      enterprise: "bg-purple-100 text-purple-700",
    };
    return (
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", planColors[value] ?? "bg-gray-100 text-gray-700")}>
        {value}
      </span>
    );
  }

  // Date formatting
  if (col.toLowerCase().includes("at") && typeof value === "string" && value.includes("T")) {
    try {
      const d = new Date(value);
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(value);
    }
  }

  // Adoption rate with color
  if (col === "adoptionRate" && typeof value === "string") {
    const pct = parseInt(value);
    const color = pct >= 60 ? "text-green-600" : pct >= 30 ? "text-yellow-600" : "text-red-600";
    return <span className={cn("font-medium", color)}>{value}</span>;
  }

  // Fill rate with color
  if (col === "fillRate" && typeof value === "string") {
    const pct = parseInt(value);
    const color = pct >= 80 ? "text-green-600" : pct >= 50 ? "text-yellow-600" : "text-red-600";
    return <span className={cn("font-medium", color)}>{value}</span>;
  }

  // Numbers
  if (typeof value === "number") {
    return <span className="font-mono">{value.toLocaleString()}</span>;
  }

  return String(value);
}
