"use client";

import { useState } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { BarChart3, TrendingUp, TrendingDown, Users, Briefcase, Activity, Award } from "lucide-react";

const PIPELINE_BY_STAGE = [
  { stage: "Discovery",    deals: 12, value: 540000,  avg_days: 8  },
  { stage: "Proposal",     deals: 8,  value: 820000,  avg_days: 14 },
  { stage: "Negotiation",  deals: 5,  value: 1200000, avg_days: 21 },
  { stage: "Closed Won",   deals: 18, value: 2100000, avg_days: 42 },
  { stage: "Closed Lost",  deals: 9,  value: 430000,  avg_days: 38 },
];

const MONTHLY_REVENUE = [
  { month: "Sep", actual: 180000, forecast: 190000 },
  { month: "Oct", actual: 220000, forecast: 210000 },
  { month: "Nov", actual: 195000, forecast: 230000 },
  { month: "Dec", actual: 310000, forecast: 280000 },
  { month: "Jan", actual: 260000, forecast: 270000 },
  { month: "Feb", actual: 295000, forecast: 300000 },
  { month: "Mar", actual: null,   forecast: 340000 },
];

const TOP_REPS = [
  { name: "Sarah Kim",       won: 580000, deals: 6, winRate: 72 },
  { name: "Marcus Chen",     won: 420000, deals: 5, winRate: 63 },
  { name: "Priya Sharma",    won: 380000, deals: 4, winRate: 57 },
  { name: "Alex Johnson",    won: 310000, deals: 4, winRate: 50 },
  { name: "Jamie Rodriguez", won: 210000, deals: 3, winRate: 43 },
];

const WIN_LOSS_BY_SOURCE = [
  { source: "Inbound referral", won: 68, lost: 32 },
  { source: "Outbound email",   won: 41, lost: 59 },
  { source: "Event / webinar",  won: 55, lost: 45 },
  { source: "Partner channel",  won: 72, lost: 28 },
  { source: "Auto-captured",    won: 48, lost: 52 },
];

const ACTIVITY_VOLUME = [
  { week: "W1", emails: 142, meetings: 18, calls: 31 },
  { week: "W2", emails: 167, meetings: 22, calls: 27 },
  { week: "W3", emails: 134, meetings: 15, calls: 35 },
  { week: "W4", emails: 189, meetings: 28, calls: 42 },
  { week: "W5", emails: 203, meetings: 31, calls: 38 },
  { week: "W6", emails: 178, meetings: 25, calls: 29 },
];

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

function SimpleBar({ value, max, color, label, currency, locale }: {
  value: number; max: number; color: string; label: string; currency: string; locale: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-muted-foreground truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="w-16 text-right text-xs font-medium tabular-nums">
        {formatCurrency(value, currency, true, locale)}
      </span>
    </div>
  );
}

type Period = "7d" | "30d" | "90d" | "1y";

export default function ReportsPage() {
  const { tenant } = useTenant();
  const currency   = tenant.defaultCurrency;
  const locale     = tenant.locale;

  const [period, setPeriod] = useState<Period>("30d");

  const maxPipelineValue = Math.max(...PIPELINE_BY_STAGE.map((s) => s.value));
  const totalWon  = PIPELINE_BY_STAGE.find((s) => s.stage === "Closed Won")?.value ?? 0;
  const totalOpen = PIPELINE_BY_STAGE
    .filter((s) => !["Closed Won", "Closed Lost"].includes(s.stage))
    .reduce((sum, s) => sum + s.value, 0);
  const winRate = Math.round((18 / (18 + 9)) * 100);

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
        <KpiCard label="Open Pipeline"   value={formatCurrency(totalOpen, currency, true, locale)} delta={12} deltaLabel="vs last period" icon={Briefcase}  color="bg-blue-100 text-blue-600" />
        <KpiCard label="Revenue Closed"  value={formatCurrency(totalWon,  currency, true, locale)} delta={18} deltaLabel="vs last period" icon={TrendingUp}  color="bg-green-100 text-green-600" />
        <KpiCard label="Win Rate"        value={`${winRate}%`}                                     delta={5}  deltaLabel="vs last period" icon={Award}       color="bg-purple-100 text-purple-600" />
        <KpiCard label="Avg Sales Cycle" value="37 days"                                           delta={-8} deltaLabel="vs last period" icon={Activity}    color="bg-orange-100 text-orange-600" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Pipeline by Stage</h2>
          <div className="space-y-3">
            {PIPELINE_BY_STAGE.map((s) => (
              <SimpleBar key={s.stage} label={s.stage} value={s.value} max={maxPipelineValue}
                currency={currency} locale={locale}
                color={s.stage === "Closed Won" ? "bg-green-500" : s.stage === "Closed Lost" ? "bg-red-400" : "bg-primary"}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-4">
            {PIPELINE_BY_STAGE.filter((s) => !s.stage.includes("Closed")).map((s) => (
              <div key={s.stage} className="text-center">
                <p className="text-lg font-bold">{s.deals}</p>
                <p className="text-xs text-muted-foreground">{s.stage}</p>
                <p className="text-xs text-muted-foreground">avg {s.avg_days}d</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Monthly Revenue</h2>
          <div className="space-y-2">
            {MONTHLY_REVENUE.map((m) => {
              const maxVal = 350000;
              return (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="w-8 shrink-0 text-xs text-muted-foreground">{m.month}</span>
                  <div className="flex-1 space-y-1">
                    {m.actual != null && (
                      <div className="flex items-center gap-1">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${(m.actual / maxVal) * 100}%` }} />
                        <span className="text-xs text-muted-foreground">{formatCurrency(m.actual, currency, true, locale)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <div className="h-2 rounded-full bg-muted-foreground/30" style={{ width: `${(m.forecast / maxVal) * 100}%` }} />
                      <span className="text-xs text-muted-foreground">{formatCurrency(m.forecast, currency, true, locale)} forecast</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-primary inline-block" /> Actual</span>
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-muted-foreground/30 inline-block" /> Forecast</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Rep Leaderboard</h2>
          <div className="space-y-3">
            {TOP_REPS.map((rep, i) => (
              <div key={rep.name} className="flex items-center gap-3">
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  i === 0 ? "bg-yellow-100 text-yellow-700" :
                  i === 1 ? "bg-gray-100 text-gray-600" :
                  i === 2 ? "bg-orange-100 text-orange-600" : "bg-muted text-muted-foreground"
                )}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{rep.name}</p>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-1">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(rep.won / TOP_REPS[0].won) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium">{formatCurrency(rep.won, currency, true, locale)}</p>
                  <p className="text-xs text-muted-foreground">{rep.winRate}% win rate</p>
                </div>
              </div>
            ))}
          </div>
        </div>

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

      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">Activity Volume (Last 6 Weeks)</h2>
        <div className="flex items-end gap-2 h-32">
          {ACTIVITY_VOLUME.map((w) => {
            const maxTotal = 250;
            return (
              <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col justify-end" style={{ height: "100px" }}>
                  <div className="w-full rounded-t-sm bg-primary/70" style={{ height: `${(w.emails / maxTotal) * 100}px` }} />
                  <div className="w-full bg-purple-400/70" style={{ height: `${(w.meetings / maxTotal) * 100}px` }} />
                  <div className="w-full rounded-b-sm bg-green-400/70" style={{ height: `${(w.calls / maxTotal) * 100}px` }} />
                </div>
                <span className="text-xs text-muted-foreground">{w.week}</span>
              </div>
            );
          })}
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
