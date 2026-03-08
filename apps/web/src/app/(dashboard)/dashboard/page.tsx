"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { formatCurrency, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { usePermissions } from "@/lib/permissions";
import { getStoredUser } from "@/lib/auth";
import {
  LayoutDashboard, TrendingUp, TrendingDown, Briefcase, Users,
  Activity, Award, ArrowRight, Mail, Phone, CheckSquare, AlertCircle,
  Zap, Star, RefreshCw, Shield, BarChart3, Target, Clock, CalendarDays,
  Headphones, UserCheck, Building2, Globe, Server, Database, Lock,
  Eye, MessageSquare, Layers,
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

// ── Persona types ─────────────────────────────────────────────────────────────

type Persona = "rep" | "manager" | "exec" | "admin";

const PERSONA_LABELS: Record<Persona, { label: string; icon: React.FC<{ className?: string }> }> = {
  rep:     { label: "Rep View",     icon: Users },
  manager: { label: "Manager View", icon: UserCheck },
  exec:    { label: "Exec View",    icon: BarChart3 },
  admin:   { label: "Admin View",   icon: Shield },
};

// ── Demo Data ──────────────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { stage: "Discovery",    value: 540000,  deals: 12, color: "bg-blue-400"   },
  { stage: "Proposal",     value: 820000,  deals: 8,  color: "bg-indigo-400" },
  { stage: "Negotiation",  value: 1200000, deals: 5,  color: "bg-purple-400" },
  { stage: "Closed Won",   value: 2100000, deals: 18, color: "bg-green-500"  },
  { stage: "Closed Lost",  value: 430000,  deals: 9,  color: "bg-red-400"    },
];
const MAX_VAL = Math.max(...PIPELINE_STAGES.map((s) => s.value));

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

// ── Rep Dashboard ──────────────────────────────────────────────────────────────

function RepDashboard({ currency, locale }: { currency: string; locale: string }) {
  return (
    <>
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="My Pipeline" value={formatCurrency(860000, currency, true, locale)} delta={12} sub="8 active deals" icon={Briefcase} color="bg-blue-100 text-blue-600" href="/pipeline" />
        <KpiCard label="Closed This Month" value={formatCurrency(320000, currency, true, locale)} delta={18} sub="3 deals closed won" icon={TrendingUp} color="bg-green-100 text-green-600" href="/reports" />
        <KpiCard label="Tasks Due Today" value="7" delta={-2} sub="3 overdue" icon={CheckSquare} color="bg-orange-100 text-orange-600" href="/tasks" />
        <KpiCard label="Quota Attainment" value="64%" delta={8} sub="$320K / $500K" icon={Target} color="bg-purple-100 text-purple-600" href="/forecasting" />
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
        </div>
      </div>

      {/* Middle row */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* My Activity Today */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Today&apos;s Activity</h2>
            <Link href="/activities" className="flex items-center gap-1 text-xs text-primary hover:underline">All <ArrowRight className="h-3 w-3" /></Link>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: "Emails", value: "12", target: "20", color: "text-blue-600" },
              { label: "Calls", value: "8", target: "15", color: "text-green-600" },
              { label: "Meetings", value: "2", target: "3", color: "text-purple-600" },
              { label: "Tasks", value: "5", target: "7", color: "text-orange-600" },
            ].map(({ label, value, target, color }) => (
              <div key={label} className="text-center rounded-lg bg-muted/40 p-3">
                <p className={cn("text-lg font-bold", color)}>{value}<span className="text-xs text-muted-foreground font-normal">/{target}</span></p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2.5">
            {RECENT_ACTIVITIES.slice(0, 4).map((a) => {
              const Icon = a.icon;
              return (
                <div key={a.id} className="flex items-start gap-3">
                  <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", a.color)}><Icon className="h-3.5 w-3.5" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{a.subject}</p>
                    <p className="text-xs text-muted-foreground">{a.when}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Deals needing attention */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><AlertCircle className="h-4 w-4 text-orange-500" /> Needs Attention</h2>
            <Link href="/pipeline" className="flex items-center gap-1 text-xs text-primary hover:underline">Pipeline <ArrowRight className="h-3 w-3" /></Link>
          </div>
          <div className="space-y-3">
            {STALE_DEALS.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.stage} · {d.days} days inactive</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", d.risk === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>{d.risk}</span>
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(d.value, currency, true, locale)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sequence & Review status */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Link href="/sequences" className="rounded-xl border bg-card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-3"><Layers className="h-4 w-4 text-indigo-500" /> <span className="font-semibold text-sm">Active Sequences</span></div>
          <p className="text-2xl font-bold">3</p>
          <p className="text-xs text-muted-foreground mt-1">127 contacts enrolled · 18 replied this week</p>
        </Link>
        <Link href="/review" className="rounded-xl border bg-card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-3"><Eye className="h-4 w-4 text-purple-500" /><span className="font-semibold text-sm">Review Queue</span></div>
          <p className="text-2xl font-bold text-purple-600">7</p>
          <p className="text-xs text-muted-foreground mt-1">AI extractions pending your review</p>
        </Link>
        <Link href="/calling" className="rounded-xl border bg-card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-3"><Headphones className="h-4 w-4 text-emerald-500" /><span className="font-semibold text-sm">Calling Today</span></div>
          <p className="text-2xl font-bold">8 / 15</p>
          <p className="text-xs text-muted-foreground mt-1">32% connect rate · 2 meetings booked</p>
        </Link>
      </div>
    </>
  );
}

// ── Manager Dashboard ─────────────────────────────────────────────────────────

function ManagerDashboard({ currency, locale }: { currency: string; locale: string }) {
  return (
    <>
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Team Pipeline" value={formatCurrency(4800000, currency, true, locale)} delta={15} sub="4 reps · 25 active deals" icon={Briefcase} color="bg-blue-100 text-blue-600" href="/pipeline" />
        <KpiCard label="Team Revenue (30d)" value={formatCurrency(2100000, currency, true, locale)} delta={22} sub="18 deals closed" icon={TrendingUp} color="bg-green-100 text-green-600" href="/reports" />
        <KpiCard label="Forecast Accuracy" value="91%" delta={3} sub="Q4 predicted vs actual" icon={Target} color="bg-purple-100 text-purple-600" href="/forecasting" />
        <KpiCard label="Team Win Rate" value="67%" delta={5} sub="vs 58% last quarter" icon={Award} color="bg-orange-100 text-orange-600" href="/insights" />
      </div>

      {/* Team Performance */}
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
            { label: "Begin Pipeline", value: 8200000, color: "bg-blue-400", height: 70 },
            { label: "+ New", value: 4600000, color: "bg-green-400", height: 39 },
            { label: "+ Moved Up", value: 1800000, color: "bg-emerald-400", height: 15 },
            { label: "- Moved Down", value: -1200000, color: "bg-orange-400", height: 10 },
            { label: "- Closed Won", value: -4200000, color: "bg-green-600", height: 36 },
            { label: "- Closed Lost", value: -1400000, color: "bg-red-400", height: 12 },
            { label: "End Pipeline", value: 7800000, color: "bg-blue-500", height: 66 },
          ].map((bar) => (
            <div key={bar.label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] font-medium tabular-nums">{formatCurrency(Math.abs(bar.value), currency, true, locale)}</span>
              <div className={cn("w-full rounded-t", bar.color)} style={{ height: `${bar.height}%` }} />
              <span className="text-[10px] text-muted-foreground text-center leading-tight">{bar.label}</span>
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
        <h2 className="mb-4 font-semibold flex items-center gap-2"><Server className="h-4 w-4 text-green-500" /> System Health</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { name: "API Gateway", status: "healthy", latency: "12ms" },
            { name: "Auth Service", status: "healthy", latency: "8ms" },
            { name: "Graph Core", status: "healthy", latency: "15ms" },
            { name: "AI Engine", status: "healthy", latency: "45ms" },
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

// ── Main Dashboard Page ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const { tenant } = useTenant();
  const perms = usePermissions();
  const currency = tenant.defaultCurrency;
  const locale   = tenant.locale;
  const [refreshing, setRefreshing] = useState(false);

  // Auto-detect persona from role
  const defaultPersona: Persona = perms.isSuperAdmin || perms.isAdmin ? "admin" : perms.isManager ? "manager" : "rep";
  const [persona, setPersona] = useState<Persona>(defaultPersona);

  // Available personas based on role
  const availablePersonas: Persona[] = perms.isSuperAdmin || perms.isAdmin
    ? ["rep", "manager", "exec", "admin"]
    : perms.isManager
    ? ["rep", "manager", "exec"]
    : ["rep"];

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    window.location.reload();
  }, []);

  const [userName, setUserName] = useState("");
  useEffect(() => {
    const u = getStoredUser();
    if (u) setUserName(u.firstName ?? "");
  }, []);

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? "Good morning" : greetingHour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">{greeting}{userName ? `, ${userName}` : ""}</h1>
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
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
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
