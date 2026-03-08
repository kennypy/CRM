"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { formatCurrency, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { api } from "@/lib/api";
import {
  LayoutDashboard, TrendingUp, TrendingDown, Briefcase, Users,
  Activity, Award, ArrowRight, Mail, Phone, CheckSquare, AlertCircle,
  Zap, Star, RefreshCw,
} from "lucide-react";
import { ForecastPanel } from "@/components/ai/forecast-panel";
import { Skeleton } from "@nexcrm/ui-components";

// ── Types ────────────────────────────────────────────────────────────────────

interface Deal {
  id: string;
  name: string;
  stage: string;
  value: number;
  currency: string;
  updatedAt: string;
  realityScore?: number;
  riskFlags: string[];
  company?: { id: string; name?: string };
  ownerId?: string;
}

interface ActivityItem {
  id: string;
  type: string;
  subject?: string;
  occurredAt: string;
  direction?: string | null;
  source: string;
  autoCapture: boolean;
}

interface PipelineStage {
  stage: string;
  value: number;
  deals: number;
  color: string;
}

interface StaleDeal {
  id: string;
  name: string;
  stage: string;
  days: number;
  value: number;
  risk: "high" | "medium";
}

interface TopRep {
  name: string;
  won: number;
  winRate: number;
  deals: number;
}

interface ActivityStats {
  emailsSent: number;
  callsLogged: number;
  meetingsHeld: number;
  tasksCompleted: number;
}

interface DashboardData {
  pipelineStages: PipelineStage[];
  recentActivities: ActivityItem[];
  staleDeals: StaleDeal[];
  topReps: TopRep[];
  kpis: {
    openPipeline: number;
    openDealCount: number;
    revenue30d: number;
    closedWonCount: number;
    winRate: number;
    wonCount: number;
    lostCount: number;
    activeContacts: number;
  };
  activityStats: ActivityStats;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  lead:         "bg-slate-400",
  qualified:    "bg-sky-400",
  discovery:    "bg-blue-400",
  proposal:     "bg-indigo-400",
  negotiation:  "bg-purple-400",
  closed_won:   "bg-green-500",
  closed_lost:  "bg-red-400",
};

const STAGE_LABELS: Record<string, string> = {
  lead:         "Lead",
  qualified:    "Qualified",
  discovery:    "Discovery",
  proposal:     "Proposal",
  negotiation:  "Negotiation",
  closed_won:   "Closed Won",
  closed_lost:  "Closed Lost",
};

const ACTIVITY_ICON_MAP: Record<string, { icon: typeof Mail; color: string }> = {
  email:    { icon: Mail,       color: "bg-blue-100 text-blue-600" },
  call:     { icon: Phone,      color: "bg-green-100 text-green-600" },
  meeting:  { icon: Activity,   color: "bg-purple-100 text-purple-600" },
  note:     { icon: CheckSquare, color: "bg-orange-100 text-orange-600" },
  document: { icon: CheckSquare, color: "bg-orange-100 text-orange-600" },
};

function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchDashboardData(): Promise<DashboardData> {
  // Fetch deals (up to 200 to get a good picture), activities, and contacts in parallel
  const [dealsRes, activitiesRes, contactsRes, allActivitiesRes] = await Promise.all([
    api.get("/api/v1/deals?limit=200"),
    api.get("/api/v1/activities?limit=5"),
    api.get("/api/v1/contacts?limit=1"),
    api.get("/api/v1/activities?limit=200"),
  ]);

  // Parse responses, defaulting to empty arrays on failure
  const dealsBody = dealsRes.ok ? await dealsRes.json() : { success: false };
  const activitiesBody = activitiesRes.ok ? await activitiesRes.json() : { success: false };
  const contactsBody = contactsRes.ok ? await contactsRes.json() : { success: false };
  const allActivitiesBody = allActivitiesRes.ok ? await allActivitiesRes.json() : { success: false };

  const deals: Deal[] = dealsBody.success ? dealsBody.data : [];
  const activities: ActivityItem[] = activitiesBody.success ? activitiesBody.data : [];
  const allActivities: ActivityItem[] = allActivitiesBody.success ? allActivitiesBody.data : [];

  // ── Pipeline stages aggregation ──────────────────────────────────────────
  const stageMap = new Map<string, { value: number; deals: number }>();
  for (const deal of deals) {
    const existing = stageMap.get(deal.stage) ?? { value: 0, deals: 0 };
    existing.value += deal.value ?? 0;
    existing.deals += 1;
    stageMap.set(deal.stage, existing);
  }

  const stageOrder = ["lead", "qualified", "discovery", "proposal", "negotiation", "closed_won", "closed_lost"];
  const pipelineStages: PipelineStage[] = stageOrder
    .filter((s) => stageMap.has(s))
    .map((s) => ({
      stage: STAGE_LABELS[s] ?? s,
      value: stageMap.get(s)!.value,
      deals: stageMap.get(s)!.deals,
      color: STAGE_COLORS[s] ?? "bg-gray-400",
    }));

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const openStages = new Set(["lead", "qualified", "discovery", "proposal", "negotiation"]);
  const openDeals = deals.filter((d) => openStages.has(d.stage));
  const closedWon = deals.filter((d) => d.stage === "closed_won");
  const closedLost = deals.filter((d) => d.stage === "closed_lost");

  const openPipeline = openDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const revenue30d = closedWon.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const wonCount = closedWon.length;
  const lostCount = closedLost.length;
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

  // Contacts total — use pagination info if available
  const contactsTotal = contactsBody.success
    ? (contactsBody.pagination?.total ?? contactsBody.data?.length ?? 0)
    : 0;

  // ── Stale deals (open deals sorted by oldest updatedAt) ───────────────────
  const staleDealCandidates = openDeals
    .map((d) => ({
      id: d.id,
      name: d.company?.name ? `${d.company.name} — ${d.name}` : d.name,
      stage: STAGE_LABELS[d.stage] ?? d.stage,
      days: daysSince(d.updatedAt),
      value: d.value ?? 0,
      risk: (d.realityScore != null && d.realityScore < 50 ? "high" : "medium") as "high" | "medium",
    }))
    .filter((d) => d.days >= 5)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  // ── Top reps (from closed-won deals, grouped by ownerId) ──────────────────
  const repMap = new Map<string, { won: number; deals: number }>();
  for (const d of closedWon) {
    const ownerId = d.ownerId ?? "unknown";
    const existing = repMap.get(ownerId) ?? { won: 0, deals: 0 };
    existing.won += d.value ?? 0;
    existing.deals += 1;
    repMap.set(ownerId, existing);
  }
  // Also count losses per owner for win rate
  const repLossMap = new Map<string, number>();
  for (const d of closedLost) {
    const ownerId = d.ownerId ?? "unknown";
    repLossMap.set(ownerId, (repLossMap.get(ownerId) ?? 0) + 1);
  }

  const topReps: TopRep[] = Array.from(repMap.entries())
    .map(([ownerId, stats]) => {
      const losses = repLossMap.get(ownerId) ?? 0;
      const total = stats.deals + losses;
      return {
        name: ownerId.slice(0, 8), // fallback — will be replaced if user names are available
        won: stats.won,
        winRate: total > 0 ? Math.round((stats.deals / total) * 100) : 100,
        deals: stats.deals,
      };
    })
    .sort((a, b) => b.won - a.won)
    .slice(0, 3);

  // Try to resolve owner names — attempt /api/v1/users (admin-only, may fail)
  if (topReps.length > 0) {
    try {
      const usersRes = await api.get("/api/v1/users");
      if (usersRes.ok) {
        const usersBody = await usersRes.json();
        if (usersBody.success && Array.isArray(usersBody.data)) {
          const nameMap = new Map<string, string>();
          for (const u of usersBody.data) {
            nameMap.set(u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email);
          }
          for (const rep of topReps) {
            // rep.name currently holds the ownerId prefix — find the full id from repMap
            const fullId = Array.from(repMap.keys()).find((k) => k.startsWith(rep.name));
            if (fullId && nameMap.has(fullId)) {
              rep.name = nameMap.get(fullId)!;
            }
          }
        }
      }
    } catch {
      // Non-fatal: keep truncated IDs as names
    }
  }

  // ── Activity stats (count by type from the larger fetch) ──────────────────
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthActivities = allActivities.filter(
    (a) => new Date(a.occurredAt) >= startOfMonth
  );
  const activityStats: ActivityStats = {
    emailsSent: thisMonthActivities.filter((a) => a.type === "email").length,
    callsLogged: thisMonthActivities.filter((a) => a.type === "call").length,
    meetingsHeld: thisMonthActivities.filter((a) => a.type === "meeting").length,
    tasksCompleted: thisMonthActivities.filter((a) => a.type === "note" || a.type === "document").length,
  };

  return {
    pipelineStages,
    recentActivities: activities,
    staleDeals: staleDealCandidates,
    topReps,
    kpis: {
      openPipeline,
      openDealCount: openDeals.length,
      revenue30d,
      closedWonCount: wonCount,
      winRate,
      wonCount,
      lostCount,
      activeContacts: contactsTotal,
    },
    activityStats,
  };
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color, href }: {
  label: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>; color: string; href?: string;
}) {
  const inner = (
    <div className={cn("rounded-xl border bg-card p-5 transition-shadow", href && "hover:shadow-md cursor-pointer")}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className={cn("rounded-lg p-2.5", color)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ── Skeleton loaders ─────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
    </div>
  );
}

function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { tenant } = useTenant();
  const currency = tenant.defaultCurrency;
  const locale   = tenant.locale;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fetchedRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      setError(false);
      const result = await fetchDashboardData();
      setData(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full flex-col gap-5 overflow-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Dashboard</h1>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <CardSkeleton rows={5} />
          <CardSkeleton rows={5} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="flex h-full flex-col gap-5 overflow-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Dashboard</h1>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">Unable to load dashboard data.</p>
          <button
            onClick={handleRefresh}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { pipelineStages, recentActivities, staleDeals, topReps, kpis, activityStats } = data;
  const maxPipelineVal = Math.max(...pipelineStages.map((s) => s.value), 1);

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Dashboard</h1>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Open Pipeline"
          value={formatCurrency(kpis.openPipeline, currency, true, locale)}
          sub={`${kpis.openDealCount} active deal${kpis.openDealCount !== 1 ? "s" : ""}`}
          icon={Briefcase}
          color="bg-blue-100 text-blue-600"
          href="/pipeline"
        />
        <KpiCard
          label="Revenue (Closed Won)"
          value={formatCurrency(kpis.revenue30d, currency, true, locale)}
          sub={`${kpis.closedWonCount} deal${kpis.closedWonCount !== 1 ? "s" : ""} closed won`}
          icon={TrendingUp}
          color="bg-green-100 text-green-600"
          href="/reports"
        />
        <KpiCard
          label="Win Rate"
          value={kpis.wonCount + kpis.lostCount > 0 ? `${kpis.winRate}%` : "N/A"}
          sub={kpis.wonCount + kpis.lostCount > 0 ? `${kpis.wonCount} won / ${kpis.lostCount} lost` : "No closed deals yet"}
          icon={Award}
          color="bg-purple-100 text-purple-600"
          href="/reports"
        />
        <KpiCard
          label="Active Contacts"
          value={kpis.activeContacts.toLocaleString(locale)}
          sub="Contacts in system"
          icon={Users}
          color="bg-orange-100 text-orange-600"
          href="/contacts"
        />
      </div>

      {/* Middle row: Pipeline + Recent Activity */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Pipeline by stage */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Pipeline by Stage</h2>
            <Link href="/pipeline" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Full view <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {pipelineStages.length === 0 ? (
            <EmptyState message="No deals yet" />
          ) : (
            <div className="space-y-3">
              {pipelineStages.map((s) => (
                <div key={s.stage} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{s.stage}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", s.color)}
                      style={{ width: `${(s.value / maxPipelineVal) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-right shrink-0">
                    <span className="text-xs text-muted-foreground">{s.deals}d</span>
                    <span className="text-xs font-medium w-16 text-right tabular-nums">
                      {formatCurrency(s.value, currency, true, locale)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Recent Activity</h2>
            <Link href="/activities" className="flex items-center gap-1 text-xs text-primary hover:underline">
              All activity <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {recentActivities.length === 0 ? (
            <EmptyState message="No recent activities" />
          ) : (
            <div className="space-y-3">
              {recentActivities.map((a) => {
                const mapping = ACTIVITY_ICON_MAP[a.type] ?? ACTIVITY_ICON_MAP.note;
                const Icon = mapping.icon;
                return (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", mapping.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.subject || `${a.type} activity`}</p>
                      <p className="text-xs text-muted-foreground">{timeAgo(a.occurredAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: Stale deals + Top Reps */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Deals needing attention */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-500" /> Needs Attention
            </h2>
            <Link href="/pipeline" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Pipeline <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {staleDeals.length === 0 ? (
            <EmptyState message="All deals are on track" />
          ) : (
            <div className="space-y-3">
              {staleDeals.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.stage} · {d.days} days inactive</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium",
                      d.risk === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>
                      {d.risk}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCurrency(d.value, currency, true, locale)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Reps */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" /> Top Performers
            </h2>
            <Link href="/reports" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Full leaderboard <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {topReps.length === 0 ? (
            <EmptyState message="No closed deals yet" />
          ) : (
            <div className="space-y-4">
              {topReps.map((rep, i) => (
                <div key={rep.name} className="flex items-center gap-3">
                  <span className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    i === 0 ? "bg-yellow-100 text-yellow-700" : i === 1 ? "bg-gray-100 text-gray-600" : "bg-orange-100 text-orange-600"
                  )}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{rep.name}</p>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(rep.won / (topReps[0]?.won || 1)) * 100}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{formatCurrency(rep.won, currency, true, locale)}</p>
                    <p className="text-xs text-muted-foreground">{rep.winRate}% win rate</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Forecast */}
      <ForecastPanel />

      {/* Activity summary stats */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" /> Activity This Month
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Emails sent",     value: activityStats.emailsSent.toLocaleString(locale),     color: "text-blue-600" },
            { label: "Calls logged",    value: activityStats.callsLogged.toLocaleString(locale),    color: "text-green-600" },
            { label: "Meetings held",   value: activityStats.meetingsHeld.toLocaleString(locale),   color: "text-purple-600" },
            { label: "Tasks completed", value: activityStats.tasksCompleted.toLocaleString(locale), color: "text-orange-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center rounded-lg bg-muted/40 p-4">
              <p className={cn("text-2xl font-bold", color)}>{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
