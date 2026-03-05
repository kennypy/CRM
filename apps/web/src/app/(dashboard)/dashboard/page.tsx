"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { formatCurrency, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import {
  LayoutDashboard, TrendingUp, TrendingDown, Briefcase, Users,
  Activity, Award, ArrowRight, Mail, Phone, CheckSquare, AlertCircle,
  Zap, Star, RefreshCw,
} from "lucide-react";

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, delta, sub, icon: Icon, color, href }: {
  label: string; value: string; delta?: number; sub?: string;
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
      {delta != null && (
        <div className={cn("mt-3 flex items-center gap-1 text-xs font-medium", delta >= 0 ? "text-green-600" : "text-red-600")}>
          {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {delta >= 0 ? "+" : ""}{delta}% vs last 30 days
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ── Pipeline Mini Chart ────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { stage: "Discovery",    value: 540000,  deals: 12, color: "bg-blue-400"   },
  { stage: "Proposal",     value: 820000,  deals: 8,  color: "bg-indigo-400" },
  { stage: "Negotiation",  value: 1200000, deals: 5,  color: "bg-purple-400" },
  { stage: "Closed Won",   value: 2100000, deals: 18, color: "bg-green-500"  },
  { stage: "Closed Lost",  value: 430000,  deals: 9,  color: "bg-red-400"    },
];
const MAX_VAL = Math.max(...PIPELINE_STAGES.map((s) => s.value));

// ── Recent Activities (mock) ───────────────────────────────────────────────────

const RECENT_ACTIVITIES = [
  { id: "1", type: "email",   subject: "Follow-up: Acme Corp renewal",   when: "5m ago",  icon: Mail,    color: "bg-blue-100 text-blue-600"   },
  { id: "2", type: "call",    subject: "Discovery call — TechStart Inc",  when: "1h ago",  icon: Phone,   color: "bg-green-100 text-green-600"  },
  { id: "3", type: "task",    subject: "Send legal review documents",     when: "2h ago",  icon: CheckSquare, color: "bg-orange-100 text-orange-600" },
  { id: "4", type: "meeting", subject: "Quarterly business review",       when: "Yesterday", icon: Activity, color: "bg-purple-100 text-purple-600" },
  { id: "5", type: "email",   subject: "Intro — Globex platform demo",   when: "Yesterday", icon: Mail,    color: "bg-blue-100 text-blue-600"   },
];

// ── Deals Needing Attention ────────────────────────────────────────────────────

const STALE_DEALS = [
  { id: "1", name: "Globex Corp — Platform",   stage: "Negotiation", days: 12, value: 280000, risk: "high"   },
  { id: "2", name: "Initech — Starter Plan",   stage: "Proposal",    days: 8,  value: 42000,  risk: "medium" },
  { id: "3", name: "Umbrella Co — Enterprise", stage: "Discovery",   days: 15, value: 450000, risk: "high"   },
];

// ── Top Reps ──────────────────────────────────────────────────────────────────

const TOP_REPS = [
  { name: "Sarah Kim",    won: 580000, winRate: 72, deals: 6  },
  { name: "Marcus Chen",  won: 420000, winRate: 63, deals: 5  },
  { name: "Priya Sharma", won: 380000, winRate: 57, deals: 4  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { tenant } = useTenant();
  const currency = tenant.defaultCurrency;
  const locale   = tenant.locale;
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    // Full reload ensures any server-side data and cached responses are refreshed.
    // Replace with targeted data re-fetches once API calls replace demo data.
    window.location.reload();
  }, []);

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
          value={formatCurrency(2560000, currency, true, locale)}
          delta={12}
          sub="25 active deals"
          icon={Briefcase}
          color="bg-blue-100 text-blue-600"
          href="/pipeline"
        />
        <KpiCard
          label="Revenue (30d)"
          value={formatCurrency(2100000, currency, true, locale)}
          delta={18}
          sub="18 deals closed won"
          icon={TrendingUp}
          color="bg-green-100 text-green-600"
          href="/reports"
        />
        <KpiCard
          label="Win Rate"
          value="67%"
          delta={5}
          sub="18 won / 9 lost"
          icon={Award}
          color="bg-purple-100 text-purple-600"
          href="/reports"
        />
        <KpiCard
          label="Active Contacts"
          value="1,247"
          delta={8}
          sub="43 auto-captured this month"
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
          <div className="space-y-3">
            {PIPELINE_STAGES.map((s) => (
              <div key={s.stage} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{s.stage}</span>
                <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", s.color)}
                    style={{ width: `${(s.value / MAX_VAL) * 100}%` }}
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
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Recent Activity</h2>
            <Link href="/activities" className="flex items-center gap-1 text-xs text-primary hover:underline">
              All activity <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {RECENT_ACTIVITIES.map((a) => {
              const Icon = a.icon;
              return (
                <div key={a.id} className="flex items-start gap-3">
                  <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", a.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.subject}</p>
                    <p className="text-xs text-muted-foreground">{a.when}</p>
                  </div>
                </div>
              );
            })}
          </div>
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
          <div className="space-y-3">
            {STALE_DEALS.map((d) => (
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
          <div className="space-y-4">
            {TOP_REPS.map((rep, i) => (
              <div key={rep.name} className="flex items-center gap-3">
                <span className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  i === 0 ? "bg-yellow-100 text-yellow-700" : i === 1 ? "bg-gray-100 text-gray-600" : "bg-orange-100 text-orange-600"
                )}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{rep.name}</p>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(rep.won / TOP_REPS[0].won) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{formatCurrency(rep.won, currency, true, locale)}</p>
                  <p className="text-xs text-muted-foreground">{rep.winRate}% win rate</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Activity summary stats */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" /> Activity This Month
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Emails sent",    value: "632",  color: "text-blue-600" },
            { label: "Calls logged",   value: "148",  color: "text-green-600" },
            { label: "Meetings held",  value: "87",   color: "text-purple-600" },
            { label: "Tasks completed",value: "214",  color: "text-orange-600" },
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
