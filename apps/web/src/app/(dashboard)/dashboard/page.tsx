"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatCurrency, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { getStoredUser } from "@/lib/auth";
import {
  LayoutDashboard, TrendingUp, TrendingDown, Briefcase, Users,
  Activity, Award, ArrowRight, Mail, Phone, CheckSquare, AlertCircle,
  Zap, Star, RefreshCw, Shield, BarChart3, Target, Clock, CalendarDays,
  Headphones, UserCheck, Building2, Globe, Server, Database, Lock,
  Eye, MessageSquare, Layers,
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

// ── Persona types ─────────────────────────────────────────────────────────────

type Persona = "rep" | "manager" | "exec" | "admin";

const PERSONA_LABELS: Record<Persona, { label: string; icon: React.FC<{ className?: string }> }> = {
  rep:     { label: "Rep View",     icon: Users },
  manager: { label: "Manager View", icon: UserCheck },
  exec:    { label: "Exec View",    icon: BarChart3 },
  admin:   { label: "Admin View",   icon: Shield },
};

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

// ── Demo Data ──────────────────────────────────────────────────────────────────

const RECENT_ACTIVITIES = [
  { id: "1", type: "email",   subject: "Follow-up: Acme Corp renewal",   when: "5m ago",  icon: Mail,    color: "bg-blue-100 text-blue-600"   },
  { id: "2", type: "call",    subject: "Discovery call — TechStart Inc",  when: "1h ago",  icon: Phone,   color: "bg-green-100 text-green-600"  },
  { id: "3", type: "task",    subject: "Send legal review documents",     when: "2h ago",  icon: CheckSquare, color: "bg-orange-100 text-orange-600" },
  { id: "4", type: "meeting", subject: "Quarterly business review",       when: "Yesterday", icon: Activity, color: "bg-purple-100 text-purple-600" },
  { id: "5", type: "email",   subject: "Intro — Globex platform demo",   when: "Yesterday", icon: Mail,    color: "bg-blue-100 text-blue-600"   },
];

const STALE_DEALS = [
  { id: "1", name: "Globex Corp — Platform",   stage: "Negotiation", days: 12, value: 280000, risk: "high" as const   },
  { id: "2", name: "Initech — Starter Plan",   stage: "Proposal",    days: 8,  value: 42000,  risk: "medium" as const },
  { id: "3", name: "Umbrella Co — Enterprise", stage: "Discovery",   days: 15, value: 450000, risk: "high" as const   },
];

const TOP_REPS = [
  { name: "Sarah Kim",    won: 580000, winRate: 72, deals: 6, activities: 234, calls: 48 },
  { name: "Marcus Chen",  won: 420000, winRate: 63, deals: 5, activities: 198, calls: 35 },
  { name: "Priya Sharma", won: 380000, winRate: 57, deals: 4, activities: 167, calls: 29 },
  { name: "Alex Johnson", won: 210000, winRate: 45, deals: 3, activities: 142, calls: 22 },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { tenant } = useTenant();
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
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
            <h1 className="text-xl font-semibold">{t("title")}</h1>
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
            <h1 className="text-xl font-semibold">{t("title")}</h1>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {tc("refresh")}
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

// ── Rep Dashboard ──────────────────────────────────────────────────────────────

function RepDashboard({ currency, locale }: { currency: string; locale: string }) {
  return (
    <>
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
          label={t("activeContacts")}
          value={kpis.activeContacts.toLocaleString(locale)}
          sub="Contacts in system"
          icon={Users}
          color="bg-orange-100 text-orange-600"
          href="/contacts"
        />
      </div>

      {/* AI Intelligence Brief */}
      <div className="rounded-xl border bg-gradient-to-r from-primary/5 to-primary/[0.02] p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Zap className="h-5 w-5 text-primary" /></div>
          <div>
            <h2 className="font-semibold">AI Intelligence Brief</h2>
            <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <p>• <strong>Acme Corp</strong> — CFO confirmed $450K budget in yesterday&apos;s email. Move to Commit forecast.</p>
              <p>• <strong>TechStart</strong> — Champion mentioned competitor (HubSpot) in call. Schedule competitive displacement demo.</p>
              <p>• <strong>Globex</strong> — No contact response in 12 days. Reality Score dropped to 45. Consider executive sponsor outreach.</p>
              <p>• Your <strong>connect rate</strong> is 15% higher on Tuesdays 10-11am. Consider shifting call blocks.</p>
            </div>
            <Link href="/insights" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              View full insights <ArrowRight className="h-3 w-3" />
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
            <h2 className="font-semibold">{t("recentActivity")}</h2>
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

        {/* Deals needing attention */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><AlertCircle className="h-4 w-4 text-orange-500" /> Needs Attention</h2>
            <Link href="/pipeline" className="flex items-center gap-1 text-xs text-primary hover:underline">Pipeline <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {staleDeals.length === 0 ? (
            <EmptyState message={t("noRiskAlerts")} />
          ) : (
            <div className="space-y-3">
              {staleDeals.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.stage} · {t("staleDays", { days: d.days })}</p>
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><Star className="h-4 w-4 text-yellow-500" /> Team Performance</h2>
          <Link href="/insights" className="flex items-center gap-1 text-xs text-primary hover:underline">Full analytics <ArrowRight className="h-3 w-3" /></Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4">#</th>
                <th className="pb-2 pr-4">Rep</th>
                <th className="pb-2 pr-4 text-right">Closed</th>
                <th className="pb-2 pr-4 text-right">Pipeline</th>
                <th className="pb-2 pr-4 text-right">Win Rate</th>
                <th className="pb-2 pr-4 text-right">Activities</th>
                <th className="pb-2 pr-4 text-right">Calls</th>
                <th className="pb-2 text-right">Quota %</th>
              </tr>
            </thead>
            <tbody>
              {TOP_REPS.map((rep, i) => (
                <tr key={rep.name} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 pr-4">
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold", i === 0 ? "bg-yellow-100 text-yellow-700" : i === 1 ? "bg-gray-100 text-gray-600" : "bg-muted text-muted-foreground")}>{i + 1}</span>
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{rep.name}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{formatCurrency(rep.won, currency, true, locale)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{formatCurrency(rep.won * 1.8, currency, true, locale)}</td>
                  <td className="py-2.5 pr-4 text-right">
                    <span className={cn("font-medium", rep.winRate >= 60 ? "text-green-600" : rep.winRate >= 40 ? "text-yellow-600" : "text-red-600")}>{rep.winRate}%</span>
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{rep.activities}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{rep.calls}</td>
                  <td className="py-2.5 text-right">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", rep.winRate >= 60 ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")}>
                      {Math.round(rep.won / 5000)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manager-specific rows */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Coaching Opportunities */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><MessageSquare className="h-4 w-4 text-blue-500" /> Coaching Opportunities</h2>
            <Link href="/coaching" className="flex items-center gap-1 text-xs text-primary hover:underline">Coaching hub <ArrowRight className="h-3 w-3" /></Link>
          </div>
          <div className="space-y-3">
            {[
              { rep: "Alex Johnson", issue: "Connect rate 22% (team avg 32%)", action: "Review call openings together", severity: "high" },
              { rep: "Marcus Chen", issue: "Talk-to-listen ratio 62% (target < 45%)", action: "Practice active listening techniques", severity: "medium" },
              { rep: "Priya Sharma", issue: "3 deals stalled > 14 days", action: "Help with multi-threaded outreach", severity: "medium" },
            ].map((c) => (
              <div key={c.rep} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{c.rep}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", c.severity === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>{c.severity}</span>
                </div>
                <p className="text-xs text-muted-foreground">{c.issue}</p>
                <p className="text-xs text-primary mt-1">→ {c.action}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Forecast Summary */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-purple-500" /> Q1 Forecast Summary</h2>
            <Link href="/forecasting" className="flex items-center gap-1 text-xs text-primary hover:underline">Full forecast <ArrowRight className="h-3 w-3" /></Link>
          </div>
          <div className="space-y-3">
            {[
              { label: "Closed Won", value: 2100000, color: "bg-green-500", pct: 100 },
              { label: "Commit", value: 1200000, color: "bg-blue-500", pct: 57 },
              { label: "Best Case", value: 800000, color: "bg-indigo-400", pct: 38 },
              { label: "Pipeline", value: 1500000, color: "bg-purple-400", pct: 71 },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">{s.label}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full", s.color)} style={{ width: `${s.pct}%` }} />
                </div>
                <span className="text-xs font-medium w-16 text-right tabular-nums">{formatCurrency(s.value, currency, true, locale)}</span>
              </div>
            ))}
            <div className="mt-2 pt-2 border-t flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Team Quota</span>
              <span className="font-bold">{formatCurrency(2000000, currency, true, locale)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Coverage Ratio</span>
              <span className={cn("font-bold", 2.8 >= 3 ? "text-green-600" : "text-yellow-600")}>2.8x</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live calls and deals needing attention */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Link href="/coaching" className="rounded-xl border bg-card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-3"><Headphones className="h-4 w-4 text-emerald-500" /><span className="font-semibold text-sm">Live Calls</span></div>
          <p className="text-2xl font-bold">3</p>
          <p className="text-xs text-muted-foreground mt-1">Active calls you can listen in on</p>
        </Link>
        <Link href="/review" className="rounded-xl border bg-card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-3"><Eye className="h-4 w-4 text-purple-500" /><span className="font-semibold text-sm">Pending Reviews</span></div>
          <p className="text-2xl font-bold text-purple-600">12</p>
          <p className="text-xs text-muted-foreground mt-1">Call recordings + AI extractions to review</p>
        </Link>
      </div>
    </>
  );
}

// ── Executive Dashboard ───────────────────────────────────────────────────────

function ExecDashboard({ currency, locale }: { currency: string; locale: string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Pipeline" value={formatCurrency(12800000, currency, true, locale)} delta={18} sub="3 teams · 67 deals" icon={Briefcase} color="bg-blue-100 text-blue-600" href="/pipeline" />
        <KpiCard label="ARR Closed (QTD)" value={formatCurrency(4200000, currency, true, locale)} delta={24} sub="vs $3.4M same period LY" icon={TrendingUp} color="bg-green-100 text-green-600" href="/reports" />
        <KpiCard label="Net Revenue Retention" value="118%" delta={4} sub="12% expansion · 6% churn" icon={Award} color="bg-purple-100 text-purple-600" />
        <KpiCard label="Sales Velocity" value="$42K/day" delta={11} sub="Avg deal size × win rate / cycle" icon={Zap} color="bg-orange-100 text-orange-600" href="/insights" />
      </div>

      {/* Revenue Waterfall */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">Revenue Waterfall — Q1 2026</h2>
        <div className="flex items-end gap-2 h-48">
          {[
            { label: t("emailsSent"),     value: activityStats.emailsSent.toLocaleString(locale),     color: "text-blue-600" },
            { label: t("callsLogged"),    value: activityStats.callsLogged.toLocaleString(locale),    color: "text-green-600" },
            { label: t("meetingsHeld"),   value: activityStats.meetingsHeld.toLocaleString(locale),   color: "text-purple-600" },
            { label: t("tasksCompleted"), value: activityStats.tasksCompleted.toLocaleString(locale), color: "text-orange-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center rounded-lg bg-muted/40 p-4">
              <p className={cn("text-2xl font-bold", color)}>{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Territory + Segment Performance */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Globe className="h-4 w-4 text-blue-500" /> Territory Performance</h2>
            <Link href="/territories" className="flex items-center gap-1 text-xs text-primary hover:underline">Manage <ArrowRight className="h-3 w-3" /></Link>
          </div>
          <div className="space-y-3">
            {[
              { name: "US East — Enterprise", pipeline: 4200000, attainment: 82, reps: 5 },
              { name: "US West — Mid-Market", pipeline: 3100000, attainment: 71, reps: 4 },
              { name: "EMEA", pipeline: 2800000, attainment: 65, reps: 3 },
              { name: "APAC", pipeline: 1400000, attainment: 48, reps: 2 },
            ].map((t) => (
              <div key={t.name} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.reps} reps · {formatCurrency(t.pipeline, currency, true, locale)} pipeline</p>
                </div>
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", t.attainment >= 75 ? "bg-green-100 text-green-700" : t.attainment >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700")}>{t.attainment}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4"><h2 className="font-semibold">Win/Loss by Segment</h2></div>
          <div className="space-y-3">
            {[
              { segment: "Enterprise ($100K+)", won: 8, lost: 3, winRate: 73, avgDeal: 285000 },
              { segment: "Mid-Market ($25-100K)", won: 12, lost: 5, winRate: 71, avgDeal: 52000 },
              { segment: "SMB ($5-25K)", won: 18, lost: 12, winRate: 60, avgDeal: 12000 },
              { segment: "Startup (<$5K)", won: 5, lost: 8, winRate: 38, avgDeal: 3200 },
            ].map((s) => (
              <div key={s.segment} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{s.segment}</p>
                  <p className="text-xs text-muted-foreground">{s.won}W / {s.lost}L · Avg {formatCurrency(s.avgDeal, currency, true, locale)}</p>
                </div>
                <div className="w-20">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${s.winRate}%` }} />
                  </div>
                  <p className="text-xs text-right mt-0.5 tabular-nums">{s.winRate}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Forecast accuracy and sales cycle */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3">Forecast Accuracy</h3>
          <div className="space-y-2">
            {[
              { q: "Q3 2025", accuracy: 92 },
              { q: "Q4 2025", accuracy: 88 },
              { q: "Q1 2026", accuracy: 91 },
            ].map((f) => (
              <div key={f.q} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{f.q}</span>
                <span className={cn("font-bold", f.accuracy >= 90 ? "text-green-600" : "text-yellow-600")}>{f.accuracy}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3">Sales Cycle (days)</h3>
          <div className="space-y-2">
            {[
              { segment: "Enterprise", days: 68, trend: -5 },
              { segment: "Mid-Market", days: 32, trend: -2 },
              { segment: "SMB", days: 14, trend: 1 },
            ].map((s) => (
              <div key={s.segment} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{s.segment}</span>
                <span className="font-bold">{s.days}d <span className={cn("text-xs", s.trend < 0 ? "text-green-600" : "text-red-500")}>({s.trend > 0 ? "+" : ""}{s.trend})</span></span>
              </div>
            ))}
          </div>
        </div>
        <Link href="/forecasting" className="rounded-xl border bg-card p-5 hover:shadow-md transition-shadow">
          <h3 className="text-sm font-semibold mb-3">Q1 Forecast Status</h3>
          <p className="text-2xl font-bold">{formatCurrency(4200000, currency, true, locale)}</p>
          <p className="text-xs text-muted-foreground mt-1">Committed vs {formatCurrency(5000000, currency, true, locale)} target</p>
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-green-500" style={{ width: "84%" }} />
          </div>
          <p className="text-xs text-right mt-1 text-muted-foreground">84% to target</p>
        </Link>
      </div>
    </>
  );
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────

function AdminDashboard() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Active Users" value="47" delta={8} sub="3 invited pending" icon={Users} color="bg-blue-100 text-blue-600" href="/admin" />
        <KpiCard label="API Requests (24h)" value="142K" delta={12} sub="Rate limit: 2% utilization" icon={Server} color="bg-green-100 text-green-600" href="/admin?tab=health" />
        <KpiCard label="SOC2 Compliance" value="87%" delta={5} sub="22/26 controls implemented" icon={Shield} color="bg-purple-100 text-purple-600" href="/compliance" />
        <KpiCard label="Storage Used" value="23.4 GB" delta={3} sub="of 100 GB allocation" icon={Database} color="bg-orange-100 text-orange-600" href="/admin?tab=health" />
      </div>

      {/* System Health */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold flex items-center gap-2"><Server className="h-4 w-4 text-green-500" /> {t("systemHealth")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { name: "API Gateway", status: "healthy", latency: "12ms" },
            { name: "Auth Service", status: "healthy", latency: "8ms" },
            { name: "Graph Core", status: "healthy", latency: "15ms" },
            { name: t("aiEngine"), status: "healthy", latency: "45ms" },
            { name: "Ingestion", status: "healthy", latency: "22ms" },
            { name: "Outreach", status: "healthy", latency: "18ms" },
          ].map((s) => (
            <div key={s.name} className="rounded-lg border border-border p-3 text-center">
              <div className={cn("mx-auto mb-1 h-2 w-2 rounded-full", s.status === "healthy" ? "bg-green-500" : s.status === "degraded" ? "bg-yellow-500" : "bg-red-500")} />
              <p className="text-xs font-medium">{s.name}</p>
              <p className="text-[10px] text-muted-foreground">{s.latency}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Admin quick links */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Lock className="h-4 w-4 text-red-500" /> Security</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Encryption at Rest</span><span className="text-green-600 font-medium">AES-256</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">TLS Version</span><span className="text-green-600 font-medium">1.3</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Failed Logins (24h)</span><span className="font-medium">3</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">2FA Adoption</span><span className="font-medium">89%</span></div>
          </div>
          <Link href="/admin?tab=security" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">Security settings <ArrowRight className="h-3 w-3" /></Link>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Database className="h-4 w-4 text-blue-500" /> Data Management</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Last Data Export</span><span className="font-medium">2 days ago</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Data Mirror</span><span className="text-green-600 font-medium">Synced</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Last Escrow</span><span className="font-medium">Weekly</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Open DSRs</span><span className="font-medium">1</span></div>
          </div>
          <Link href="/compliance" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">Compliance center <ArrowRight className="h-3 w-3" /></Link>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Zap className="h-4 w-4 text-purple-500" /> AI Usage</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">AI Events (MTD)</span><span className="font-medium">34,521</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Quota</span><span className="font-medium">50,000</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Extraction Accuracy</span><span className="text-green-600 font-medium">94%</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Review Queue Rate</span><span className="font-medium">8%</span></div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-purple-500" style={{ width: "69%" }} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 text-right">69% of monthly quota used</p>
        </div>
      </div>

      {/* Recent audit log */}
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Recent Audit Log</h2>
          <Link href="/admin?tab=audit" className="flex items-center gap-1 text-xs text-primary hover:underline">Full log <ArrowRight className="h-3 w-3" /></Link>
        </div>
        <div className="space-y-2">
          {[
            { time: "2m ago", user: "Sarah Kim", action: "deal.updated", entity: "Acme Corp — Enterprise", detail: "Stage: Proposal → Negotiation" },
            { time: "15m ago", user: "System", action: "ai.extraction", entity: "Email from john@acme.com", detail: "Budget confirmed: $450K (confidence: 87%)" },
            { time: "1h ago", user: "Admin", action: "user.invited", entity: "jamie@company.com", detail: "Role: rep" },
            { time: "3h ago", user: "Marcus Chen", action: "sequence.activated", entity: "Q1 Enterprise Outbound", detail: "42 contacts enrolled" },
            { time: "5h ago", user: "System", action: "mirror.synced", entity: "AWS S3", detail: "142,531 records · 23.4 GB" },
          ].map((entry, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">{entry.time}</span>
              <span className="w-24 shrink-0 text-xs font-medium">{entry.user}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{entry.action}</span>
              <span className="flex-1 truncate text-xs text-muted-foreground">{entry.entity} — {entry.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

  // ── Main render (persona switcher + greeting) ─────────────────────────────

  const perms = usePermissions();

  // Auto-detect persona from role
  const defaultPersona: Persona = perms.isSuperAdmin || perms.isAdmin ? "admin" : perms.isManager ? "manager" : "rep";
  const [persona, setPersona] = useState<Persona>(defaultPersona);

  // Available personas based on role
  const availablePersonas: Persona[] = perms.isSuperAdmin || perms.isAdmin
    ? ["rep", "manager", "exec", "admin"]
    : perms.isManager
    ? ["rep", "manager", "exec"]
    : ["rep"];

  const [userName, setUserName] = useState("");
  useEffect(() => {
    const u = getStoredUser();
    if (u) setUserName(u.firstName ?? "");
  }, []);

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? t("goodMorning", { name: userName }) : greetingHour < 17 ? t("goodAfternoon", { name: userName }) : t("goodEvening", { name: userName });

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">{greeting}</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Persona switcher */}
          {availablePersonas.length > 1 && (
            <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
              {availablePersonas.map((p) => {
                const cfg = PERSONA_LABELS[p];
                const Icon = cfg.icon;
                return (
                  <button
                    key={p}
                    onClick={() => setPersona(p)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      persona === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span className="hidden sm:block">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> {tc("refresh")}
          </button>
        </div>
      </div>

      {/* Render persona-specific dashboard */}
      {persona === "rep" && <RepDashboard currency={currency} locale={locale} />}
      {persona === "manager" && <ManagerDashboard currency={currency} locale={locale} />}
      {persona === "exec" && <ExecDashboard currency={currency} locale={locale} />}
      {persona === "admin" && <AdminDashboard />}
    </div>
  );
}
