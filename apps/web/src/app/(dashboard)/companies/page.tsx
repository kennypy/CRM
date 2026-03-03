"use client";

/**
 * Companies List Page
 *
 * Searchable, paginated table of all Company nodes in the graph.
 * Each row shows: name, domain, industry, plan tier, deal count, last activity.
 * The "AI Auto-Captured" pill signals zero-entry sources.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { AddCompanyModal } from "@/components/modals/add-company-modal";
import {
  Building2,
  Search,
  Plus,
  RefreshCw,
  AlertCircle,
  Globe,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Briefcase,
  Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  annualRevenue?: number;
  plan?: string;        // "enterprise" | "smb" | "startup"
  openDeals?: number;
  lastActivityAt?: string;
  source: string;       // "auto" | "user"
  websiteUrl?: string;
  createdAt: string;
}

// ── Plan badge ────────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan?: string }) {
  if (!plan) return <span className="text-xs text-muted-foreground">—</span>;

  const styles: Record<string, string> = {
    enterprise: "bg-purple-100 text-purple-700",
    smb:        "bg-blue-100 text-blue-700",
    startup:    "bg-green-100 text-green-700",
  };

  return (
    <span className={cn(
      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
      styles[plan.toLowerCase()] ?? "bg-muted text-muted-foreground"
    )}>
      {plan}
    </span>
  );
}

// ── Source pill ───────────────────────────────────────────────────────────────

function SourcePill({ source }: { source: string }) {
  return source !== "user" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
      <Zap className="h-2.5 w-2.5" />
      Auto
    </span>
  ) : (
    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
      Manual
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showAdd, setShowAdd]     = useState(false);
  const timer                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (v: string) => {
    setSearch(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 300);
  };

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await api.get(`/api/v1/companies?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCompanies(json.data ?? []);
      setTotal(json.pagination?.total ?? json.data?.length ?? 0);
    } catch (e: any) {
      setError(e.message ?? "Failed to load companies");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const formatRevenue = (v?: number) => {
    if (!v) return "—";
    if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000)     return `$${(v / 1_000_000).toFixed(1)}M`;
    return `$${(v / 1_000).toFixed(0)}K`;
  };

  const formatEmployees = (v?: number) => {
    if (!v) return "—";
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return String(v);
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Companies</h1>
          {!loading && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {total.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchCompanies}
            disabled={loading}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add Company
          </button>
        </div>
      </div>
      {showAdd && <AddCompanyModal onClose={() => setShowAdd(false)} onCreated={() => fetchCompanies()} />}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name or domain…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              {["Company", "Domain", "Industry", "Employees", "Revenue", "Open Deals", "Last Activity", "Source"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-3/4 rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : companies.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  {debouncedSearch ? "No companies match your search" : "No companies yet"}
                </td>
              </tr>
            ) : (
              companies.map((co) => (
                <tr key={co.id} className="transition-colors hover:bg-muted/40">
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-xs uppercase text-muted-foreground">
                        {co.name.charAt(0)}
                      </div>
                      <span className="font-medium text-foreground">{co.name}</span>
                    </div>
                  </td>

                  {/* Domain */}
                  <td className="px-4 py-3">
                    {co.domain ? (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Globe className="h-3 w-3" />
                        <a
                          href={`https://${co.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary hover:underline"
                        >
                          {co.domain}
                        </a>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Industry */}
                  <td className="px-4 py-3 text-muted-foreground capitalize">
                    {co.industry ?? "—"}
                  </td>

                  {/* Employees */}
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">
                    {formatEmployees(co.employeeCount)}
                  </td>

                  {/* Revenue */}
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">
                    {formatRevenue(co.annualRevenue)}
                  </td>

                  {/* Open deals */}
                  <td className="px-4 py-3">
                    {co.openDeals != null && co.openDeals > 0 ? (
                      <span className="flex items-center gap-1 text-foreground">
                        <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                        {co.openDeals}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Last activity */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {co.lastActivityAt ? formatRelativeTime(co.lastActivityAt) : "Never"}
                  </td>

                  {/* Source */}
                  <td className="px-4 py-3">
                    <SourcePill source={co.source} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Page {page} of {totalPages} ({total.toLocaleString()} total)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || loading}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
