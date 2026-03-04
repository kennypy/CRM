"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { formatCurrency, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { BarChart3, TrendingUp, TrendingDown, Users, Briefcase, Activity, Award, ArrowRight } from "lucide-react";

// Period-keyed data sets
const PIPELINE_DATA: Record<string, { stage: string; deals: number; value: number; avg_days: number }[]> = {
  "7d":  [
    { stage: "Discovery",   deals: 3,  value: 120000,  avg_days: 3  },
    { stage: "Proposal",    deals: 2,  value: 210000,  avg_days: 5  },
    { stage: "Negotiation", deals: 1,  value: 280000,  avg_days: 7  },
    { stage: "Closed Won",  deals: 4,  value: 380000,  avg_days: 12 },
    { stage: "Closed Lost", deals: 2,  value: 90000,   avg_days: 10 },
  ],
  "30d": [
    { stage: "Discovery",   deals: 12, value: 540000,  avg_days: 8  },
    { stage: "Proposal",    deals: 8,  value: 820000,  avg_days: 14 },
    { stage: "Negotiation", deals: 5,  value: 1200000, avg_days: 21 },
    { stage: "Closed Won",  deals: 18, value: 2100000, avg_days: 42 },
    { stage: "Closed Lost", deals: 9,  value: 430000,  avg_days: 38 },
  ],
  "90d": [
    { stage: "Discovery",   deals: 34, value: 1540000, avg_days: 9  },
    { stage: "Proposal",    deals: 22, value: 2820000, avg_days: 16 },
    { stage: "Negotiation", deals: 14, value: 3600000, avg_days: 24 },
    { stage: "Closed Won",  deals: 51, value: 6800000, avg_days: 45 },
    { stage: "Closed Lost", deals: 27, value: 1430000, avg_days: 41 },
  ],
  "1y":  [
    { stage: "Discovery",   deals: 120, value: 5400000,  avg_days: 10 },
    { stage: "Proposal",    deals: 84,  value: 10200000, avg_days: 17 },
    { stage: "Negotiation", deals: 55,  value: 15000000, avg_days: 26 },
    { stage: "Closed Won",  deals: 198, value: 28500000, avg_days: 47 },
    { stage: "Closed Lost", deals: 91,  value: 5300000,  avg_days: 43 },
  ],
};

const REVENUE_DATA: Record<string, { label: string; actual: number | null; forecast: number }[]> = {
  "7d": [
    { label: "Mon", actual: 42000,  forecast: 40000 },
    { label: "Tue", actual: 38000,  forecast: 41000 },
    { label: "Wed", actual: 55000,  forecast: 48000 },
    { label: "Thu", actual: 61000,  forecast: 52000 },
    { label: "Fri", actual: 47000,  forecast: 50000 },
    { label: "Sat", actual: 12000,  forecast: 15000 },
    { label: "Sun", actual: null,   forecast: 14000 },
  ],
  "30d": [
    { label: "Sep", actual: 180000, forecast: 190000 },
    { label: "Oct", actual: 220000, forecast: 210000 },
    { label: "Nov", actual: 195000, forecast: 230000 },
    { label: "Dec", actual: 310000, forecast: 280000 },
    { label: "Jan", actual: 260000, forecast: 270000 },
    { label: "Feb", actual: 295000, forecast: 300000 },
    { label: "Mar", actual: null,   forecast: 340000 },
  ],
  "90d": [
    { label: "Oct", actual: 620000,  forecast: 600000  },
    { label: "Nov", actual: 590000,  forecast: 640000  },
    { label: "Dec", actual: 880000,  forecast: 820000  },
    { label: "Jan", actual: 760000,  forecast: 780000  },
    { label: "Feb", actual: 840000,  forecast: 860000  },
    { label: "Mar", actual: null,    forecast: 920000  },
  ],
  "1y": [
    { label: "Q1 '25", actual: 2100000, forecast: 2000000 },
    { label: "Q2 '25", actual: 2600000, forecast: 2500000 },
    { label: "Q3 '25", actual: 3100000, forecast: 2900000 },
    { label: "Q4 '25", actual: 3800000, forecast: 3500000 },
    { label: "Q1 '26", actual: null,    forecast: 4100000 },
  ],
};

const REPS_DATA: Record<string, { name: string; won: number; deals: number; winRate: number }[]> = {
  "7d": [
    { name: "Sarah Kim",       won: 95000,  deals: 1, winRate: 80 },
    { name: "Marcus Chen",     won: 62000,  deals: 1, winRate: 67 },
    { name: "Priya Sharma",    won: 55000,  deals: 1, winRate: 60 },
    { name: "Alex Johnson",    won: 42000,  deals: 1, winRate: 50 },
    { name: "Jamie Rodriguez", won: 28000,  deals: 1, winRate: 40 },
  ],
  "30d": [
    { name: "Sarah Kim",       won: 580000, deals: 6, winRate: 72 },
    { name: "Marcus Chen",     won: 420000, deals: 5, winRate: 63 },
    { name: "Priya Sharma",    won: 380000, deals: 4, winRate: 57 },
    { name: "Alex Johnson",    won: 310000, deals: 4, winRate: 50 },
    { name: "Jamie Rodriguez", won: 210000, deals: 3, winRate: 43 },
  ],
  "90d": [
    { name: "Sarah Kim",       won: 1820000, deals: 18, winRate: 74 },
    { name: "Marcus Chen",     won: 1340000, deals: 15, winRate: 65 },
    { name: "Priya Sharma",    won: 1120000, deals: 13, winRate: 59 },
    { name: "Alex Johnson",    won: 980000,  deals: 12, winRate: 52 },
    { name: "Jamie Rodriguez", won: 640000,  deals: 9,  winRate: 45 },
  ],
  "1y": [
    { name: "Sarah Kim",       won: 7800000, deals: 68, winRate: 76 },
    { name: "Marcus Chen",     won: 5900000, deals: 55, winRate: 67 },
    { name: "Priya Sharma",    won: 5200000, deals: 48, winRate: 61 },
    { name: "Alex Johnson",    won: 4300000, deals: 44, winRate: 54 },
    { name: "Jamie Rodriguez", won: 2900000, deals: 32, winRate: 47 },
  ],
};

const KPI_DELTAS: Record<string, { pipeline: number; revenue: number; winRate: number; cycle: number }> = {
  "7d":  { pipeline: 4,  revenue: 8,  winRate: 2,  cycle: -3  },
  "30d": { pipeline: 12, revenue: 18, winRate: 5,  cycle: -8  },
  "90d": { pipeline: 21, revenue: 32, winRate: 9,  cycle: -12 },
  "1y":  { pipeline: 38, revenue: 54, winRate: 14, cycle: -19 },
};

const WIN_LOSS_BY_SOURCE = [
  { source: "Inbound referral", won: 68, lost: 32 },
  { source: "Outbound email",   won: 41, lost: 59 },
  { source: "Event / webinar",  won: 55, lost: 45 },
  { source: "Partner channel",  won: 72, lost: 28 },
  { source: "Auto-captured",    won: 48, lost: 52 },
];

const ACTIVITY_DATA: Record<string, { label: string; emails: number; meetings: number; calls: number }[]> = {
  "7d": [
    { label: "Mon", emails: 38,  meetings: 5,  calls: 8  },
    { label: "Tue", emails: 45,  meetings: 7,  calls: 10 },
    { label: "Wed", emails: 52,  meetings: 8,  calls: 12 },
    { label: "Thu", emails: 41,  meetings: 6,  calls: 9  },
    { label: "Fri", emails: 35,  meetings: 4,  calls: 7  },
    { label: "Sat", emails: 8,   meetings: 1,  calls: 2  },
    { label: "Sun", emails: 5,   meetings: 0,  calls: 1  },
  ],
  "30d": [
    { label: "W1", emails: 142, meetings: 18, calls: 31 },
    { label: "W2", emails: 167, meetings: 22, calls: 27 },
    { label: "W3", emails: 134, meetings: 15, calls: 35 },
    { label: "W4", emails: 189, meetings: 28, calls: 42 },
    { label: "W5", emails: 203, meetings: 31, calls: 38 },
    { label: "W6", emails: 178, meetings: 25, calls: 29 },
  ],
  "90d": [
    { label: "Oct", emails: 580,  meetings: 72, calls: 125 },
    { label: "Nov", emails: 610,  meetings: 78, calls: 138 },
    { label: "Dec", emails: 490,  meetings: 61, calls: 102 },
    { label: "Jan", emails: 640,  meetings: 84, calls: 149 },
    { label: "Feb", emails: 720,  meetings: 92, calls: 162 },
    { label: "Mar", emails: 340,  meetings: 41, calls: 78  },
  ],
  "1y": [
    { label: "Q1", emails: 2100, meetings: 268, calls: 480 },
    { label: "Q2", emails: 2400, meetings: 310, calls: 540 },
    { label: "Q3", emails: 2650, meetings: 340, calls: 595 },
    { label: "Q4", emails: 2200, meetings: 285, calls: 500 },
  ],
};

function KpiCard({ label, value, delta, deltaLabel, icon: Icon, color }: {
  label: string; value: string; delta: number; deltaLabel: string;
  icon: React.FC<{ className?: string }>; color: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
        <div className={cn("rounded-lg p-2", color)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className={cn("mt-3 flex items-center gap-1 text-xs font-medium", delta >= 0 ? "text-green-600" : "text-red-600")}>
        {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {delta >= 0 ? "+" : ""}{delta}% {deltaLabel}
      </div>
    </div>
  );
}

type Period = "7d" | "30d" | "90d" | "1y";

export default function ReportsPage() {
  const { tenant } = useTenant();
  const currency   = tenant.defaultCurrency;
  const locale     = tenant.locale;

  const [period, setPeriod] = useState<Period>("30d");

  const pipeline    = PIPELINE_DATA[period];
  const revenue     = REVENUE_DATA[period];
  const reps        = REPS_DATA[period];
  const activity    = ACTIVITY_DATA[period];
  const deltas      = KPI_DELTAS[period];

  const maxPipelineValue = Math.max(...pipeline.map((s) => s.value));
  const totalWon  = pipeline.find((s) => s.stage === "Closed Won")?.value  ?? 0;
  const totalOpen = pipeline
    .filter((s) => !["Closed Won", "Closed Lost"].includes(s.stage))
    .reduce((sum, s) => sum + s.value, 0);
  const wonDeals  = pipeline.find((s) => s.stage === "Closed Won")?.deals  ?? 0;
  const lostDeals = pipeline.find((s) => s.stage === "Closed Lost")?.deals ?? 0;
  const winRate   = Math.round((wonDeals / Math.max(wonDeals + lostDeals, 1)) * 100);

  const maxRevenue  = Math.max(...revenue.map((r) => Math.max(r.actual ?? 0, r.forecast)));
  const maxActivity = Math.max(...activity.map((w) => w.emails + w.meetings + w.calls));

  const periodLabel = period === "7d" ? "vs prior 7 days" : period === "30d" ? "vs prior 30 days" : period === "90d" ? "vs prior quarter" : "vs prior year";

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Reports</h1>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["7d", "30d", "90d", "1y"] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors",
                period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Open Pipeline"   value={formatCurrency(totalOpen, currency, true, locale)} delta={deltas.pipeline} deltaLabel={periodLabel} icon={Briefcase}  color="bg-blue-100 text-blue-600" />
        <KpiCard label="Revenue Closed"  value={formatCurrency(totalWon,  currency, true, locale)} delta={deltas.revenue}  deltaLabel={periodLabel} icon={TrendingUp}  color="bg-green-100 text-green-600" />
        <KpiCard label="Win Rate"        value={`${winRate}%`}                                     delta={deltas.winRate}  deltaLabel={periodLabel} icon={Award}       color="bg-purple-100 text-purple-600" />
        <KpiCard label="Avg Sales Cycle" value={`${pipeline.find(s => s.stage === "Closed Won")?.avg_days ?? 37} days`}   delta={deltas.cycle}    deltaLabel={periodLabel} icon={Activity}    color="bg-orange-100 text-orange-600" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pipeline by Stage — each row drills into /pipeline */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Pipeline by Stage</h2>
            <Link href="/pipeline" className="flex items-center gap-1 text-xs text-primary hover:underline">
              View pipeline <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {pipeline.map((s) => (
              <Link key={s.stage} href="/pipeline"
                className="group flex items-center gap-3 rounded-lg px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors">
                <span className="w-24 shrink-0 text-xs text-muted-foreground group-hover:text-foreground truncate transition-colors">{s.stage}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", s.stage === "Closed Won" ? "bg-green-500" : s.stage === "Closed Lost" ? "bg-red-400" : "bg-primary")}
                    style={{ width: `${(s.value / maxPipelineValue) * 100}%` }} />
                </div>
                <span className="w-16 text-right text-xs font-medium tabular-nums">
                  {formatCurrency(s.value, currency, true, locale)}
                </span>
              </Link>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-4">
            {pipeline.filter((s) => !s.stage.includes("Closed")).map((s) => (
              <Link key={s.stage} href="/pipeline" className="text-center hover:opacity-70 transition-opacity">
                <p className="text-lg font-bold">{s.deals}</p>
                <p className="text-xs text-muted-foreground">{s.stage}</p>
                <p className="text-xs text-muted-foreground">avg {s.avg_days}d</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Monthly / Period Revenue */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">{period === "7d" ? "Daily Revenue" : period === "1y" ? "Quarterly Revenue" : "Monthly Revenue"}</h2>
          <div className="space-y-2">
            {revenue.map((m) => (
              <div key={m.label} className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">{m.label}</span>
                <div className="flex-1 space-y-1">
                  {m.actual != null && (
                    <div className="flex items-center gap-1">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${(m.actual / maxRevenue) * 100}%` }} />
                      <span className="text-xs text-muted-foreground">{formatCurrency(m.actual, currency, true, locale)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <div className="h-2 rounded-full bg-muted-foreground/30" style={{ width: `${(m.forecast / maxRevenue) * 100}%` }} />
                    <span className="text-xs text-muted-foreground">{formatCurrency(m.forecast, currency, true, locale)} forecast</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-primary inline-block" /> Actual</span>
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-muted-foreground/30 inline-block" /> Forecast</span>
          </div>
        </div>

        {/* Rep Leaderboard — each row links to /contacts */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Rep Leaderboard</h2>
            <Link href="/contacts" className="flex items-center gap-1 text-xs text-primary hover:underline">
              View contacts <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {reps.map((rep, i) => (
              <Link key={rep.name} href="/contacts"
                className="group flex items-center gap-3 rounded-lg px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors">
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  i === 0 ? "bg-yellow-100 text-yellow-700" :
                  i === 1 ? "bg-gray-100 text-gray-600" :
                  i === 2 ? "bg-orange-100 text-orange-600" : "bg-muted text-muted-foreground"
                )}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{rep.name}</p>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-1">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(rep.won / reps[0].won) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium">{formatCurrency(rep.won, currency, true, locale)}</p>
                  <p className="text-xs text-muted-foreground">{rep.winRate}% win rate</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Win Rate by Lead Source */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Win Rate by Lead Source</h2>
          <div className="space-y-3">
            {WIN_LOSS_BY_SOURCE.map((s) => (
              <div key={s.source}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{s.source}</span>
                  <span className="font-medium">{s.won}% win</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                  <div className="h-full bg-green-500 rounded-l-full" style={{ width: `${s.won}%` }} />
                  <div className="h-full bg-red-400 rounded-r-full flex-1" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Activity Volume */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">
          Activity Volume ({period === "7d" ? "Last 7 Days" : period === "30d" ? "Last 6 Weeks" : period === "90d" ? "Last 6 Months" : "By Quarter"})
        </h2>
        <div className="flex items-end gap-2 h-32">
          {activity.map((w) => (
            <div key={w.label} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col justify-end" style={{ height: "100px" }}>
                <div className="w-full rounded-t-sm bg-primary/70"
                  style={{ height: `${(w.emails / maxActivity) * 100}px` }} />
                <div className="w-full bg-purple-400/70"
                  style={{ height: `${(w.meetings / maxActivity) * 100}px` }} />
                <div className="w-full rounded-b-sm bg-green-400/70"
                  style={{ height: `${(w.calls / maxActivity) * 100}px` }} />
              </div>
              <span className="text-xs text-muted-foreground">{w.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-primary/70 inline-block" /> Emails</span>
          <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-purple-400/70 inline-block" /> Meetings</span>
          <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-green-400/70 inline-block" /> Calls</span>
        </div>
      </div>
    </div>
  );
}
