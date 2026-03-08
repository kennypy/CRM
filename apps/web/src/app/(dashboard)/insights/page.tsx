"use client";

import { useState, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { usePermissions } from "@/lib/permissions";
import {
  BarChart3, TrendingUp, TrendingDown, Users, Phone, Mail,
  Calendar, CheckSquare, Target, Award, ArrowDown,
  ArrowUp, Clock, Zap, AlertTriangle, Lightbulb, Brain,
  Plus, Filter, Download, RefreshCw,
  Activity, Eye, MessageSquare, PlayCircle, UserCheck,
  DollarSign, Briefcase, PieChart, Layers, GitBranch,
  Star, AlertCircle, Flame,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PersonaTab = "rep" | "manager" | "exec";
type TimePeriod = "daily" | "weekly" | "monthly";

// ── Demo Data ─────────────────────────────────────────────────────────────────

const ACTIVITY_DATA = {
  daily:   { emails: 24, calls: 12, meetings: 3, tasks: 8,  total: 47 },
  weekly:  { emails: 142, calls: 67, meetings: 18, tasks: 53, total: 280 },
  monthly: { emails: 632, calls: 284, meetings: 72, tasks: 214, total: 1202 },
};

const ENGAGEMENT_METRICS = {
  openRate:    { value: 62.4, delta: 4.2,  benchmark: 58 },
  replyRate:   { value: 18.7, delta: -1.3, benchmark: 15 },
  responseRate:{ value: 34.2, delta: 2.8,  benchmark: 30 },
  bounceRate:  { value: 2.1,  delta: -0.5, benchmark: 3  },
};

const CALL_METRICS = {
  connectRate:   { value: 32.4, delta: 3.1 },
  avgDuration:   { value: 4.2,  delta: 0.3 },
  talkTimeRatio: { value: 58,   delta: -2 },
  callsPerDay:   { value: 14.2, delta: 1.8 },
  voicemails:    { value: 42,   delta: -5 },
  callbacks:     { value: 8,    delta: 2 },
};

const SEQUENCE_METRICS = {
  activeSequences:  12,
  totalEnrolled:    847,
  completionRate:   68.4,
  conversionRate:   14.2,
  avgStepsCompleted: 4.3,
  optOutRate:       3.1,
  topSequence:      { name: "Enterprise Outbound Q1", conversion: 22.4 },
  sequences: [
    { name: "Enterprise Outbound Q1",  enrolled: 234, completed: 168, converted: 52, rate: 22.2 },
    { name: "SMB Re-engagement",       enrolled: 189, completed: 142, converted: 28, rate: 14.8 },
    { name: "Inbound Demo Follow-up",  enrolled: 156, completed: 98,  converted: 34, rate: 21.8 },
    { name: "Partner Channel Nurture", enrolled: 142, completed: 88,  converted: 12, rate: 8.5  },
    { name: "Expansion Play",          enrolled: 126, completed: 95,  converted: 18, rate: 14.3 },
  ],
};

const PIPELINE_CONTRIBUTION = {
  dealsCreated:   { value: 18, delta: 12, amount: 2340000 },
  dealsAdvanced:  { value: 24, delta: 8,  amount: 3120000 },
  avgDealSize:    { value: 130000, delta: 5 },
  avgCycleLength: { value: 34, delta: -3 },
};

// Activity heatmap: rows = days of week, cols = hours (8-18)
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const HEATMAP_DATA: number[][] = [
  [2, 5, 8, 12, 6, 3, 7, 14, 10, 8, 3],   // Mon
  [3, 7, 11, 15, 4, 2, 9, 12, 11, 6, 2],   // Tue
  [1, 4, 9, 14, 8, 5, 11, 16, 13, 9, 4],   // Wed
  [4, 6, 10, 11, 5, 3, 8, 13, 12, 7, 3],   // Thu
  [2, 3, 7, 9, 4, 2, 5, 8, 6, 4, 1],       // Fri
];
const HEATMAP_MAX = Math.max(...HEATMAP_DATA.flat());

// ── Manager Data ──────────────────────────────────────────────────────────────

const TEAM_MEMBERS = [
  { id: "1", name: "Sarah Kim",      role: "AE",  activities: 312, pipeline: 1420000, revenue: 580000, winRate: 72, calls: 89,  emails: 156, meetings: 24, rampWeek: null, trend: [65, 72, 68, 80, 75, 82, 78] },
  { id: "2", name: "Marcus Chen",    role: "AE",  activities: 287, pipeline: 980000,  revenue: 420000, winRate: 63, calls: 76,  emails: 142, meetings: 19, rampWeek: null, trend: [55, 60, 58, 65, 62, 70, 68] },
  { id: "3", name: "Priya Sharma",   role: "AE",  activities: 264, pipeline: 870000,  revenue: 380000, winRate: 57, calls: 68,  emails: 134, meetings: 16, rampWeek: null, trend: [50, 48, 55, 52, 58, 60, 62] },
  { id: "4", name: "James Wilson",   role: "AE",  activities: 198, pipeline: 640000,  revenue: 210000, winRate: 44, calls: 52,  emails: 98,  meetings: 12, rampWeek: null, trend: [40, 38, 42, 35, 45, 40, 38] },
  { id: "5", name: "Lisa Park",      role: "SDR", activities: 342, pipeline: 520000,  revenue: 0,      winRate: 0,  calls: 124, emails: 178, meetings: 8,  rampWeek: null, trend: [70, 75, 72, 78, 80, 82, 85] },
  { id: "6", name: "Alex Torres",    role: "AE",  activities: 145, pipeline: 380000,  revenue: 95000,  winRate: 38, calls: 34,  emails: 72,  meetings: 9,  rampWeek: 6,    trend: [15, 20, 25, 30, 32, 35, 38] },
];

const TEAM_BENCHMARKS = {
  activitiesPerWeek: 60,
  pipelineMinimum:   500000,
  winRateTarget:     55,
  callsPerDay:       12,
  meetingsPerWeek:   4,
};

const COACHING_ALERTS = [
  { rep: "James Wilson",  issue: "Win rate 44% (target 55%)", severity: "high" as const,   suggestion: "Review lost deal patterns. Consider joint calls with top performer." },
  { rep: "Alex Torres",   issue: "Ramp week 6 — pipeline below target", severity: "medium" as const, suggestion: "Schedule weekly 1:1 pipeline review. Assign shadow opportunities." },
  { rep: "James Wilson",  issue: "Call volume 52 (team avg 74)", severity: "medium" as const, suggestion: "Set daily call targets. Review time allocation." },
  { rep: "Priya Sharma",  issue: "Meeting-to-close ratio 1:8 (team avg 1:5)", severity: "low" as const, suggestion: "Focus on qualification criteria before scheduling meetings." },
];

// ── Exec Data ─────────────────────────────────────────────────────────────────

const REVENUE_WATERFALL = [
  { label: "Beginning Pipeline", value: 8200000, type: "neutral" as const },
  { label: "New Pipeline",       value: 2340000, type: "positive" as const },
  { label: "Moved Up",           value: 1450000, type: "positive" as const },
  { label: "Moved Down",         value: -820000, type: "negative" as const },
  { label: "Closed Won",         value: -2100000, type: "won" as const },
  { label: "Closed Lost",        value: -1430000, type: "negative" as const },
  { label: "Ending Pipeline",    value: 7640000, type: "neutral" as const },
];

const WIN_LOSS_BY_SEGMENT = [
  { segment: "Enterprise",  won: 8,  lost: 3,  winRate: 72.7, avgDealSize: 280000, avgCycle: 62 },
  { segment: "Mid-Market",  won: 12, lost: 5,  winRate: 70.6, avgDealSize: 95000,  avgCycle: 38 },
  { segment: "SMB",          won: 14, lost: 8,  winRate: 63.6, avgDealSize: 28000,  avgCycle: 18 },
  { segment: "Strategic",   won: 3,  lost: 2,  winRate: 60.0, avgDealSize: 520000, avgCycle: 94 },
];

const WIN_LOSS_BY_INDUSTRY = [
  { industry: "Technology",    won: 12, lost: 4,  winRate: 75.0 },
  { industry: "Financial Svcs", won: 8,  lost: 3,  winRate: 72.7 },
  { industry: "Healthcare",   won: 6,  lost: 4,  winRate: 60.0 },
  { industry: "Manufacturing", won: 5,  lost: 3,  winRate: 62.5 },
  { industry: "Retail",       won: 6,  lost: 4,  winRate: 60.0 },
];

const FORECAST_ACCURACY = [
  { period: "Q1 2025", predicted: 2800000, actual: 2650000, accuracy: 94.6 },
  { period: "Q2 2025", predicted: 3100000, actual: 2920000, accuracy: 94.2 },
  { period: "Q3 2025", predicted: 3400000, actual: 3180000, accuracy: 93.5 },
  { period: "Q4 2025", predicted: 3800000, actual: 3520000, accuracy: 92.6 },
  { period: "Q1 2026", predicted: 4200000, actual: null,    accuracy: null },
];

const SALES_CYCLE_TRENDS = [
  { month: "Sep", days: 38 },
  { month: "Oct", days: 36 },
  { month: "Nov", days: 35 },
  { month: "Dec", days: 42 },
  { month: "Jan", days: 37 },
  { month: "Feb", days: 34 },
];

const CAC_TRENDS = [
  { month: "Sep", cac: 12400 },
  { month: "Oct", cac: 11800 },
  { month: "Nov", cac: 11200 },
  { month: "Dec", cac: 13100 },
  { month: "Jan", cac: 10800 },
  { month: "Feb", cac: 10200 },
];

const TERRITORY_DATA = [
  { territory: "North America",  pipeline: 4200000, revenue: 1800000, deals: 42, winRate: 68 },
  { territory: "EMEA",           pipeline: 2800000, revenue: 1200000, deals: 28, winRate: 62 },
  { territory: "APAC",           pipeline: 1600000, revenue: 580000,  deals: 18, winRate: 55 },
  { territory: "LATAM",          pipeline: 840000,  revenue: 320000,  deals: 12, winRate: 52 },
];

// ── Funnel Data ───────────────────────────────────────────────────────────────

const FUNNEL_STAGES = [
  { stage: "Leads",        count: 4820, velocity: null },
  { stage: "MQL",          count: 1928, velocity: 3.2 },
  { stage: "SQL",          count: 867,  velocity: 5.8 },
  { stage: "Opportunity",  count: 312,  velocity: 8.4 },
  { stage: "Closed Won",   count: 87,   velocity: 14.2 },
];

// ── AI Insights ───────────────────────────────────────────────────────────────

const AI_INSIGHTS = [
  {
    type: "recommendation" as const,
    title: "Optimal outreach window detected",
    description: "Your team's reply rates are 2.4x higher for emails sent between 10-11 AM on Tuesdays and Wednesdays. Consider shifting scheduled sends to this window.",
    impact: "high" as const,
    metric: "+24% projected reply rate",
  },
  {
    type: "anomaly" as const,
    title: "Pipeline velocity slowdown in Mid-Market",
    description: "Mid-Market deals are spending 40% longer in the Proposal stage compared to the 90-day average. 6 deals may be at risk of stalling.",
    impact: "high" as const,
    metric: "6 deals at risk",
  },
  {
    type: "best_practice" as const,
    title: "Top performer pattern: multi-threaded deals",
    description: "Sarah Kim engages an average of 3.2 stakeholders per deal vs. team average of 1.8. Multi-threaded deals close at 2x the rate.",
    impact: "medium" as const,
    metric: "2x close rate",
  },
  {
    type: "recommendation" as const,
    title: "Sequence step optimization",
    description: "Step 3 of 'Enterprise Outbound Q1' has a 45% drop-off rate. Top-performing sequences use a phone touch at this stage instead of email.",
    impact: "medium" as const,
    metric: "-45% drop-off",
  },
  {
    type: "anomaly" as const,
    title: "Unusual spike in email bounce rate",
    description: "Bounce rate increased from 2.1% to 4.8% in the past 48 hours for the 'SMB Re-engagement' sequence. Contact list may need cleaning.",
    impact: "high" as const,
    metric: "4.8% bounce rate",
  },
  {
    type: "best_practice" as const,
    title: "Call preparation correlates with connect rate",
    description: "Reps who log pre-call research notes have a 28% higher connect rate. Consider making pre-call prep a required workflow step.",
    impact: "low" as const,
    metric: "+28% connect rate",
  },
];

// ── Shared Components ─────────────────────────────────────────────────────────

function MetricCard({ label, value, delta, sub, icon: Icon, color }: {
  label: string; value: string; delta?: number; sub?: string;
  icon: React.FC<{ className?: string }>; color: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className={cn("rounded-lg p-2 shrink-0", color)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {delta != null && (
        <div className={cn("mt-2 flex items-center gap-1 text-xs font-medium",
          delta >= 0 ? "text-green-600" : "text-red-600")}>
          {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {delta >= 0 ? "+" : ""}{delta}%
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, icon: Icon, action }: {
  title: string; icon: React.FC<{ className?: string }>; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-semibold flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </h2>
      {action}
    </div>
  );
}

function Sparkline({ data, color = "text-primary" }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 64;
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(" ");

  return (
    <svg width={w} height={h} className={cn("inline-block", color)}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProgressBar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function TimePeriodToggle({ value, onChange }: { value: TimePeriod; onChange: (v: TimePeriod) => void }) {
  return (
    <div className="flex rounded-lg bg-muted p-0.5 text-xs">
      {(["daily", "weekly", "monthly"] as const).map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={cn("rounded-md px-2.5 py-1 font-medium capitalize transition-colors",
            value === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {p}
        </button>
      ))}
    </div>
  );
}

// ── Rep View ──────────────────────────────────────────────────────────────────

function RepView({ currency, locale }: { currency: string; locale: string }) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("weekly");
  const data = ACTIVITY_DATA[timePeriod];

  return (
    <div className="space-y-6">
      {/* Activity by Type */}
      <div className="rounded-xl border bg-card p-5">
        <SectionHeader title="Activities by Type" icon={Activity}
          action={<TimePeriodToggle value={timePeriod} onChange={setTimePeriod} />}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: "Emails",   value: data.emails,   icon: Mail,        color: "bg-blue-100 text-blue-600" },
            { label: "Calls",    value: data.calls,     icon: Phone,       color: "bg-green-100 text-green-600" },
            { label: "Meetings", value: data.meetings,  icon: Calendar,    color: "bg-purple-100 text-purple-600" },
            { label: "Tasks",    value: data.tasks,      icon: CheckSquare, color: "bg-orange-100 text-orange-600" },
            { label: "Total",    value: data.total,     icon: Zap,         color: "bg-primary/10 text-primary" },
          ].map(({ label, value: v, icon: Icon, color }) => (
            <div key={label} className="text-center rounded-lg bg-muted/40 p-4">
              <div className={cn("inline-flex rounded-lg p-2 mb-2", color)}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold">{v}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Engagement + Call Metrics */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Engagement Rates */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Engagement Rates" icon={Eye} />
          <div className="space-y-4">
            {[
              { label: "Open Rate",     ...ENGAGEMENT_METRICS.openRate },
              { label: "Reply Rate",    ...ENGAGEMENT_METRICS.replyRate },
              { label: "Response Rate", ...ENGAGEMENT_METRICS.responseRate },
              { label: "Bounce Rate",   ...ENGAGEMENT_METRICS.bounceRate },
            ].map(({ label, value: v, delta, benchmark }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{v}%</span>
                    <span className={cn("text-xs font-medium",
                      label === "Bounce Rate"
                        ? (delta <= 0 ? "text-green-600" : "text-red-600")
                        : (delta >= 0 ? "text-green-600" : "text-red-600"))}>
                      {delta >= 0 ? "+" : ""}{delta}%
                    </span>
                  </div>
                </div>
                <div className="relative">
                  <ProgressBar value={v} max={100}
                    color={v >= benchmark ? "bg-green-500" : "bg-amber-500"} />
                  <div className="absolute top-0 h-2 w-0.5 bg-foreground/40 rounded"
                    style={{ left: `${benchmark}%` }}
                    title={`Benchmark: ${benchmark}%`} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Benchmark: {benchmark}%</p>
              </div>
            ))}
          </div>
        </div>

        {/* Call Metrics */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Call Metrics" icon={Phone} />
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Connect Rate" value={`${CALL_METRICS.connectRate.value}%`}
              delta={CALL_METRICS.connectRate.delta} icon={UserCheck}
              color="bg-green-100 text-green-600" />
            <MetricCard label="Avg Duration" value={`${CALL_METRICS.avgDuration.value} min`}
              delta={CALL_METRICS.avgDuration.delta} icon={Clock}
              color="bg-blue-100 text-blue-600" />
            <MetricCard label="Talk/Listen Ratio" value={`${CALL_METRICS.talkTimeRatio.value}%`}
              delta={CALL_METRICS.talkTimeRatio.delta} icon={MessageSquare}
              color="bg-purple-100 text-purple-600" />
            <MetricCard label="Calls/Day" value={`${CALL_METRICS.callsPerDay.value}`}
              delta={CALL_METRICS.callsPerDay.delta} icon={Phone}
              color="bg-orange-100 text-orange-600" />
          </div>
        </div>
      </div>

      {/* Sequence Performance */}
      <div className="rounded-xl border bg-card p-5">
        <SectionHeader title="Sequence Performance" icon={GitBranch} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-5">
          <MetricCard label="Active Sequences" value={`${SEQUENCE_METRICS.activeSequences}`}
            icon={PlayCircle} color="bg-blue-100 text-blue-600" />
          <MetricCard label="Total Enrolled" value={SEQUENCE_METRICS.totalEnrolled.toLocaleString()}
            icon={Users} color="bg-purple-100 text-purple-600" />
          <MetricCard label="Completion Rate" value={`${SEQUENCE_METRICS.completionRate}%`}
            icon={CheckSquare} color="bg-green-100 text-green-600" />
          <MetricCard label="Conversion Rate" value={`${SEQUENCE_METRICS.conversionRate}%`}
            icon={Target} color="bg-orange-100 text-orange-600" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 font-medium text-muted-foreground">Sequence</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Enrolled</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Completed</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Converted</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Conv. Rate</th>
                <th className="pb-2 font-medium text-muted-foreground w-32">Progress</th>
              </tr>
            </thead>
            <tbody>
              {SEQUENCE_METRICS.sequences.map((seq) => (
                <tr key={seq.name} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-2.5 font-medium">{seq.name}</td>
                  <td className="py-2.5 text-right tabular-nums">{seq.enrolled}</td>
                  <td className="py-2.5 text-right tabular-nums">{seq.completed}</td>
                  <td className="py-2.5 text-right tabular-nums">{seq.converted}</td>
                  <td className="py-2.5 text-right">
                    <span className={cn("font-semibold tabular-nums",
                      seq.rate >= 20 ? "text-green-600" : seq.rate >= 12 ? "text-amber-600" : "text-red-600")}>
                      {seq.rate}%
                    </span>
                  </td>
                  <td className="py-2.5">
                    <ProgressBar value={seq.completed} max={seq.enrolled}
                      color={seq.rate >= 20 ? "bg-green-500" : seq.rate >= 12 ? "bg-amber-500" : "bg-red-500"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pipeline Contribution + Activity Heatmap */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Pipeline Contribution */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Pipeline Contribution" icon={Briefcase} />
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Deals Created" value={`${PIPELINE_CONTRIBUTION.dealsCreated.value}`}
              delta={PIPELINE_CONTRIBUTION.dealsCreated.delta}
              sub={formatCurrency(PIPELINE_CONTRIBUTION.dealsCreated.amount, currency, true, locale)}
              icon={Plus} color="bg-blue-100 text-blue-600" />
            <MetricCard label="Deals Advanced" value={`${PIPELINE_CONTRIBUTION.dealsAdvanced.value}`}
              delta={PIPELINE_CONTRIBUTION.dealsAdvanced.delta}
              sub={formatCurrency(PIPELINE_CONTRIBUTION.dealsAdvanced.amount, currency, true, locale)}
              icon={ArrowUp} color="bg-green-100 text-green-600" />
            <MetricCard label="Avg Deal Size"
              value={formatCurrency(PIPELINE_CONTRIBUTION.avgDealSize.value, currency, true, locale)}
              delta={PIPELINE_CONTRIBUTION.avgDealSize.delta}
              icon={DollarSign} color="bg-purple-100 text-purple-600" />
            <MetricCard label="Avg Cycle Length" value={`${PIPELINE_CONTRIBUTION.avgCycleLength.value}d`}
              delta={PIPELINE_CONTRIBUTION.avgCycleLength.delta}
              icon={Clock} color="bg-orange-100 text-orange-600" />
          </div>
        </div>

        {/* Activity Heatmap */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Activity Heatmap" icon={Flame} />
          <p className="text-xs text-muted-foreground mb-3">Response rates by day and hour</p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="w-10" />
                  {HOURS.map((h) => (
                    <th key={h} className="text-center text-xs text-muted-foreground pb-1 px-0.5">
                      {h > 12 ? `${h - 12}p` : h === 12 ? "12p" : `${h}a`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, di) => (
                  <tr key={day}>
                    <td className="text-xs text-muted-foreground pr-2 py-0.5">{day}</td>
                    {HEATMAP_DATA[di].map((val, hi) => {
                      const intensity = val / HEATMAP_MAX;
                      return (
                        <td key={hi} className="px-0.5 py-0.5">
                          <div
                            className="h-6 w-full rounded-sm transition-colors"
                            style={{
                              backgroundColor: intensity > 0.75
                                ? `rgba(34, 197, 94, ${0.3 + intensity * 0.7})`
                                : intensity > 0.5
                                ? `rgba(234, 179, 8, ${0.3 + intensity * 0.6})`
                                : intensity > 0.25
                                ? `rgba(59, 130, 246, ${0.2 + intensity * 0.5})`
                                : `rgba(148, 163, 184, ${0.1 + intensity * 0.3})`,
                            }}
                            title={`${day} ${HOURS[hi]}:00 — ${val} responses`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2 mt-2">
            <span className="text-xs text-muted-foreground">Low</span>
            <div className="flex gap-0.5">
              {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
                <div key={v} className="h-3 w-5 rounded-sm"
                  style={{ backgroundColor: `rgba(34, 197, 94, ${v})` }} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">High</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Manager View ──────────────────────────────────────────────────────────────

function ManagerView({ currency, locale }: { currency: string; locale: string }) {
  const [sortBy, setSortBy] = useState<"activities" | "pipeline" | "revenue">("revenue");
  const sorted = useMemo(() =>
    [...TEAM_MEMBERS].sort((a, b) => b[sortBy] - a[sortBy]),
    [sortBy]
  );
  const maxVal = Math.max(...sorted.map((r) => r[sortBy]));

  return (
    <div className="space-y-6">
      {/* Team Leaderboard */}
      <div className="rounded-xl border bg-card p-5">
        <SectionHeader title="Team Leaderboard" icon={Award}
          action={
            <div className="flex rounded-lg bg-muted p-0.5 text-xs">
              {(["revenue", "pipeline", "activities"] as const).map((key) => (
                <button key={key} onClick={() => setSortBy(key)}
                  className={cn("rounded-md px-2.5 py-1 font-medium capitalize transition-colors",
                    sortBy === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {key}
                </button>
              ))}
            </div>
          }
        />
        <div className="space-y-3">
          {sorted.map((rep, i) => (
            <div key={rep.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-3 hover:bg-muted/30 transition-colors">
              <span className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                i === 0 ? "bg-yellow-100 text-yellow-700" :
                i === 1 ? "bg-gray-100 text-gray-600" :
                i === 2 ? "bg-orange-100 text-orange-600" :
                "bg-muted text-muted-foreground"
              )}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{rep.name}</p>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{rep.role}</span>
                  {rep.rampWeek && (
                    <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                      Ramp W{rep.rampWeek}
                    </span>
                  )}
                </div>
                <div className="mt-1.5">
                  <ProgressBar value={rep[sortBy]} max={maxVal}
                    color={i === 0 ? "bg-yellow-500" : i === 1 ? "bg-gray-400" : i === 2 ? "bg-orange-500" : "bg-primary"} />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">
                  {sortBy === "activities" ? rep.activities.toLocaleString() :
                   formatCurrency(rep[sortBy], currency, true, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{rep.winRate}% win rate</p>
              </div>
              <Sparkline data={rep.trend}
                color={rep.trend[rep.trend.length - 1] > rep.trend[0] ? "text-green-500" : "text-red-500"} />
            </div>
          ))}
        </div>
      </div>

      {/* Rep Comparison Matrix */}
      <div className="rounded-xl border bg-card p-5">
        <SectionHeader title="Rep Comparison Matrix" icon={BarChart3} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 font-medium text-muted-foreground">Rep</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Calls</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Emails</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Meetings</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Pipeline</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Revenue</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Win Rate</th>
                <th className="pb-2 font-medium text-muted-foreground">Trend</th>
              </tr>
            </thead>
            <tbody>
              {TEAM_MEMBERS.map((rep) => (
                <tr key={rep.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{rep.name}</span>
                      <span className="text-xs text-muted-foreground">{rep.role}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{rep.calls}</td>
                  <td className="py-2.5 text-right tabular-nums">{rep.emails}</td>
                  <td className="py-2.5 text-right tabular-nums">{rep.meetings}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatCurrency(rep.pipeline, currency, true, locale)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatCurrency(rep.revenue, currency, true, locale)}</td>
                  <td className="py-2.5 text-right">
                    <span className={cn("font-semibold tabular-nums",
                      rep.winRate >= TEAM_BENCHMARKS.winRateTarget ? "text-green-600" : "text-red-600")}>
                      {rep.winRate}%
                    </span>
                  </td>
                  <td className="py-2.5">
                    <Sparkline data={rep.trend}
                      color={rep.trend[rep.trend.length - 1] > rep.trend[0] ? "text-green-500" : "text-red-500"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Coaching Opportunities + Meeting-to-Close + Ramp */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Coaching Opportunities */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Coaching Opportunities" icon={AlertTriangle} />
          <div className="space-y-3">
            {COACHING_ALERTS.map((alert, i) => (
              <div key={i} className={cn("rounded-lg border p-3",
                alert.severity === "high"   ? "border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20" :
                alert.severity === "medium" ? "border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20" :
                "border-border bg-muted/20")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium">{alert.rep}</span>
                      <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-medium",
                        alert.severity === "high"   ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400" :
                        alert.severity === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400" :
                        "bg-muted text-muted-foreground")}>
                        {alert.severity}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{alert.issue}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-start gap-1.5">
                  <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">{alert.suggestion}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          {/* Meeting-to-Close Ratio */}
          <div className="rounded-xl border bg-card p-5">
            <SectionHeader title="Meeting-to-Close Ratio" icon={Calendar} />
            <div className="space-y-3">
              {TEAM_MEMBERS.filter((r) => r.role === "AE").map((rep) => {
                const closedDeals = Math.round(rep.revenue / 95000);
                const ratio = rep.meetings > 0 ? (rep.meetings / Math.max(closedDeals, 1)).toFixed(1) : "N/A";
                return (
                  <div key={rep.id} className="flex items-center justify-between">
                    <span className="text-sm">{rep.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {rep.meetings} mtgs / {closedDeals} closed
                      </span>
                      <span className={cn("text-sm font-semibold tabular-nums",
                        Number(ratio) <= 5 ? "text-green-600" : "text-amber-600")}>
                        {ratio}:1
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ramp Analysis */}
          <div className="rounded-xl border bg-card p-5">
            <SectionHeader title="Ramp Analysis" icon={TrendingUp} />
            {TEAM_MEMBERS.filter((r) => r.rampWeek).length === 0 ? (
              <p className="text-sm text-muted-foreground">No reps currently in ramp.</p>
            ) : (
              <div className="space-y-4">
                {TEAM_MEMBERS.filter((r) => r.rampWeek).map((rep) => {
                  const rampProgress = Math.min(((rep.rampWeek ?? 0) / 12) * 100, 100);
                  const pipelineTarget = TEAM_BENCHMARKS.pipelineMinimum;
                  const pipelinePct = Math.min((rep.pipeline / pipelineTarget) * 100, 100);
                  return (
                    <div key={rep.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{rep.name}</span>
                        <span className="text-xs text-muted-foreground">Week {rep.rampWeek} of 12</span>
                      </div>
                      <div className="space-y-1.5">
                        <div>
                          <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                            <span>Ramp Progress</span>
                            <span>{rampProgress.toFixed(0)}%</span>
                          </div>
                          <ProgressBar value={rampProgress} max={100} color="bg-blue-500" />
                        </div>
                        <div>
                          <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                            <span>Pipeline vs Target</span>
                            <span>{formatCurrency(rep.pipeline, currency, true, locale)} / {formatCurrency(pipelineTarget, currency, true, locale)}</span>
                          </div>
                          <ProgressBar value={pipelinePct} max={100}
                            color={pipelinePct >= 80 ? "bg-green-500" : pipelinePct >= 50 ? "bg-amber-500" : "bg-red-500"} />
                        </div>
                      </div>
                      <Sparkline data={rep.trend} color="text-blue-500" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Exec View ─────────────────────────────────────────────────────────────────

function ExecView({ currency, locale }: { currency: string; locale: string }) {
  return (
    <div className="space-y-6">
      {/* Revenue Waterfall */}
      <div className="rounded-xl border bg-card p-5">
        <SectionHeader title="Revenue Waterfall" icon={BarChart3} />
        <div className="flex items-end gap-2 h-48 mt-4">
          {REVENUE_WATERFALL.map((item, i) => {
            const absMax = Math.max(...REVENUE_WATERFALL.map((w) => Math.abs(w.value)));
            const barHeight = (Math.abs(item.value) / absMax) * 100;
            const color = item.type === "positive" ? "bg-green-500"
              : item.type === "negative" ? "bg-red-500"
              : item.type === "won" ? "bg-emerald-600"
              : "bg-primary";

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-semibold tabular-nums">
                  {item.value < 0 ? "-" : ""}{formatCurrency(Math.abs(item.value), currency, true, locale)}
                </span>
                <div className="w-full flex items-end justify-center" style={{ height: "140px" }}>
                  <div
                    className={cn("w-full max-w-12 rounded-t-md transition-all", color)}
                    style={{ height: `${barHeight}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground text-center leading-tight mt-1">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Win/Loss Analysis */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* By Segment */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Win/Loss by Segment" icon={PieChart} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium text-muted-foreground">Segment</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Won</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Lost</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Win Rate</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Avg Deal</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Cycle</th>
                </tr>
              </thead>
              <tbody>
                {WIN_LOSS_BY_SEGMENT.map((row) => (
                  <tr key={row.segment} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 font-medium">{row.segment}</td>
                    <td className="py-2.5 text-right text-green-600 font-semibold tabular-nums">{row.won}</td>
                    <td className="py-2.5 text-right text-red-600 font-semibold tabular-nums">{row.lost}</td>
                    <td className="py-2.5 text-right">
                      <span className={cn("font-semibold tabular-nums",
                        row.winRate >= 65 ? "text-green-600" : row.winRate >= 55 ? "text-amber-600" : "text-red-600")}>
                        {row.winRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{formatCurrency(row.avgDealSize, currency, true, locale)}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">{row.avgCycle}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* By Industry */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Win/Loss by Industry" icon={Layers} />
          <div className="space-y-3">
            {WIN_LOSS_BY_INDUSTRY.map((row) => (
              <div key={row.industry}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm">{row.industry}</span>
                  <span className={cn("text-sm font-semibold tabular-nums",
                    row.winRate >= 65 ? "text-green-600" : row.winRate >= 55 ? "text-amber-600" : "text-red-600")}>
                    {row.winRate}%
                  </span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                  <div className="bg-green-500 transition-all"
                    style={{ width: `${(row.won / (row.won + row.lost)) * 100}%` }} />
                  <div className="bg-red-500 transition-all"
                    style={{ width: `${(row.lost / (row.won + row.lost)) * 100}%` }} />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-xs text-green-600">{row.won} won</span>
                  <span className="text-xs text-red-600">{row.lost} lost</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sales Cycle + Forecast Accuracy */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Sales Cycle Trends */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Sales Cycle Length Trends" icon={Clock} />
          <div className="flex items-end gap-3 h-32 mt-2">
            {SALES_CYCLE_TRENDS.map((item) => {
              const maxDays = Math.max(...SALES_CYCLE_TRENDS.map((s) => s.days));
              const pct = (item.days / maxDays) * 100;
              return (
                <div key={item.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-semibold tabular-nums">{item.days}d</span>
                  <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                    <div className="w-full max-w-8 rounded-t-md bg-primary/70 transition-all"
                      style={{ height: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{item.month}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <TrendingDown className="h-4 w-4 text-green-600" />
            <span className="text-green-600 font-medium">-4 days</span>
            <span className="text-muted-foreground">vs 6-month average</span>
          </div>
        </div>

        {/* Forecast Accuracy */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Forecast Accuracy" icon={Target} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium text-muted-foreground">Period</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Predicted</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Actual</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {FORECAST_ACCURACY.map((row) => (
                  <tr key={row.period} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 font-medium">{row.period}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {formatCurrency(row.predicted, currency, true, locale)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {row.actual ? formatCurrency(row.actual, currency, true, locale) : (
                        <span className="text-muted-foreground italic">In progress</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {row.accuracy ? (
                        <span className={cn("font-semibold tabular-nums",
                          row.accuracy >= 94 ? "text-green-600" : row.accuracy >= 90 ? "text-amber-600" : "text-red-600")}>
                          {row.accuracy}%
                        </span>
                      ) : <span className="text-muted-foreground">--</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* CAC Trends + Territory Performance */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* CAC Trends */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Customer Acquisition Cost" icon={DollarSign} />
          <div className="flex items-end gap-3 h-32 mt-2">
            {CAC_TRENDS.map((item) => {
              const maxCac = Math.max(...CAC_TRENDS.map((c) => c.cac));
              const pct = (item.cac / maxCac) * 100;
              return (
                <div key={item.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-semibold tabular-nums">
                    {formatCurrency(item.cac, currency, true, locale)}
                  </span>
                  <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                    <div className={cn("w-full max-w-8 rounded-t-md transition-all",
                      item.cac <= 11000 ? "bg-green-500" : item.cac <= 12000 ? "bg-amber-500" : "bg-red-500")}
                      style={{ height: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{item.month}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <TrendingDown className="h-4 w-4 text-green-600" />
            <span className="text-green-600 font-medium">-17.7%</span>
            <span className="text-muted-foreground">over 6 months</span>
          </div>
        </div>

        {/* Territory Performance */}
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader title="Territory Performance" icon={Target} />
          <div className="space-y-3">
            {TERRITORY_DATA.map((t) => {
              const maxPipeline = Math.max(...TERRITORY_DATA.map((td) => td.pipeline));
              return (
                <div key={t.territory} className="rounded-lg border border-border/50 p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{t.territory}</span>
                    <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5",
                      t.winRate >= 65 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                      t.winRate >= 55 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400")}>
                      {t.winRate}% win rate
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                    <div>
                      <span className="text-muted-foreground">Pipeline</span>
                      <p className="font-semibold tabular-nums">{formatCurrency(t.pipeline, currency, true, locale)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Revenue</span>
                      <p className="font-semibold tabular-nums">{formatCurrency(t.revenue, currency, true, locale)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Deals</span>
                      <p className="font-semibold tabular-nums">{t.deals}</p>
                    </div>
                  </div>
                  <ProgressBar value={t.pipeline} max={maxPipeline} color="bg-primary" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Funnel Analytics ──────────────────────────────────────────────────────────

function FunnelAnalytics() {
  const maxCount = FUNNEL_STAGES[0].count;

  return (
    <div className="rounded-xl border bg-card p-5">
      <SectionHeader title="Funnel Analytics" icon={Filter} />
      <div className="space-y-1 mt-4">
        {FUNNEL_STAGES.map((stage, i) => {
          const width = (stage.count / maxCount) * 100;
          const prevCount = i > 0 ? FUNNEL_STAGES[i - 1].count : null;
          const convRate = prevCount ? ((stage.count / prevCount) * 100).toFixed(1) : null;
          const dropOff = prevCount ? (((prevCount - stage.count) / prevCount) * 100).toFixed(1) : null;

          return (
            <div key={stage.stage} className="group">
              <div className="flex items-center gap-4">
                <div className="w-24 shrink-0 text-right">
                  <p className="text-sm font-medium">{stage.stage}</p>
                  <p className="text-xs text-muted-foreground">{stage.count.toLocaleString()}</p>
                </div>
                <div className="flex-1">
                  <div className="relative mx-auto" style={{ width: `${width}%`, minWidth: "60px" }}>
                    <div className={cn(
                      "h-10 rounded-md transition-all",
                      i === 0 ? "bg-blue-500/80" :
                      i === 1 ? "bg-indigo-500/80" :
                      i === 2 ? "bg-violet-500/80" :
                      i === 3 ? "bg-purple-500/80" :
                      "bg-green-500/80"
                    )} />
                  </div>
                </div>
                <div className="w-36 shrink-0">
                  {convRate && (
                    <div className="flex items-center gap-2">
                      <ArrowDown className="h-3 w-3 text-muted-foreground" />
                      <div>
                        <span className="text-sm font-semibold text-green-600 tabular-nums">{convRate}%</span>
                        <span className="text-xs text-muted-foreground ml-1">conversion</span>
                      </div>
                    </div>
                  )}
                  {dropOff && (
                    <p className="text-xs text-red-500 mt-0.5 tabular-nums">{dropOff}% drop-off</p>
                  )}
                </div>
                <div className="w-24 shrink-0 text-right">
                  {stage.velocity && (
                    <div>
                      <p className="text-sm font-semibold tabular-nums">{stage.velocity}d</p>
                      <p className="text-xs text-muted-foreground">velocity</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall Funnel Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="text-center rounded-lg bg-muted/40 p-3">
          <p className="text-xl font-bold text-primary">1.8%</p>
          <p className="text-xs text-muted-foreground">Lead-to-Close Rate</p>
        </div>
        <div className="text-center rounded-lg bg-muted/40 p-3">
          <p className="text-xl font-bold text-primary">31.6d</p>
          <p className="text-xs text-muted-foreground">Avg. Total Velocity</p>
        </div>
        <div className="text-center rounded-lg bg-muted/40 p-3">
          <p className="text-xl font-bold text-primary">40.0%</p>
          <p className="text-xs text-muted-foreground">MQL-to-SQL Rate</p>
        </div>
        <div className="text-center rounded-lg bg-muted/40 p-3">
          <p className="text-xl font-bold text-primary">27.9%</p>
          <p className="text-xs text-muted-foreground">Opp-to-Close Rate</p>
        </div>
      </div>
    </div>
  );
}

// ── AI Insights Panel ─────────────────────────────────────────────────────────

function AIInsightsPanel() {
  const [filter, setFilter] = useState<"all" | "recommendation" | "anomaly" | "best_practice">("all");

  const filtered = filter === "all"
    ? AI_INSIGHTS
    : AI_INSIGHTS.filter((ins) => ins.type === filter);

  const typeConfig = {
    recommendation: { label: "Recommendation", icon: Lightbulb, color: "text-blue-500", bg: "bg-blue-100 dark:bg-blue-900/30" },
    anomaly:        { label: "Anomaly",        icon: AlertCircle, color: "text-red-500",  bg: "bg-red-100 dark:bg-red-900/30" },
    best_practice:  { label: "Best Practice",  icon: Star,        color: "text-amber-500", bg: "bg-amber-100 dark:bg-amber-900/30" },
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <SectionHeader title="AI Insights" icon={Brain}
        action={
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
            {(["all", "recommendation", "anomaly", "best_practice"] as const).map((key) => (
              <button key={key} onClick={() => setFilter(key)}
                className={cn("rounded-md px-2.5 py-1 font-medium transition-colors",
                  filter === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {key === "all" ? "All" : key === "best_practice" ? "Best Practices" : key.charAt(0).toUpperCase() + key.slice(1) + "s"}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-3">
        {filtered.map((insight, i) => {
          const config = typeConfig[insight.type];
          const TypeIcon = config.icon;
          return (
            <div key={i} className="rounded-lg border border-border/50 p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-start gap-3">
                <div className={cn("rounded-lg p-2 shrink-0", config.bg)}>
                  <TypeIcon className={cn("h-4 w-4", config.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{insight.title}</h3>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      insight.impact === "high"   ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                      insight.impact === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400")}>
                      {insight.impact} impact
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Zap className="h-3 w-3 text-primary" />
                    <span className="text-xs font-semibold text-primary">{insight.metric}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const { tenant } = useTenant();
  const permissions = usePermissions();
  const currency = tenant.defaultCurrency;
  const locale = tenant.locale;

  // Default tab based on role
  const defaultTab: PersonaTab = permissions.isSuperAdmin || permissions.isAdmin
    ? "exec"
    : permissions.isManager
    ? "manager"
    : "rep";

  const [activeTab, setActiveTab] = useState<PersonaTab>(defaultTab);
  const [showFunnel, setShowFunnel] = useState(true);
  const [showAI, setShowAI] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const PERSONA_TABS: { key: PersonaTab; label: string; icon: React.FC<{ className?: string }>; minRole: string }[] = [
    { key: "rep",     label: "Rep View",     icon: Activity, minRole: "rep" },
    { key: "manager", label: "Manager View", icon: Users,    minRole: "manager" },
    { key: "exec",    label: "Exec View",    icon: Briefcase, minRole: "admin" },
  ];

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Insights & Analytics</h1>
            <p className="text-xs text-muted-foreground">
              Performance analytics, pipeline intelligence, and AI-powered recommendations
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
          <button className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Persona Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {PERSONA_TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                activeTab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}>
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showFunnel} onChange={(e) => setShowFunnel(e.target.checked)}
              className="accent-primary" />
            Funnel
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showAI} onChange={(e) => setShowAI(e.target.checked)}
              className="accent-primary" />
            AI Insights
          </label>
        </div>
      </div>

      {/* Persona Content */}
      {activeTab === "rep" && <RepView currency={currency} locale={locale} />}
      {activeTab === "manager" && <ManagerView currency={currency} locale={locale} />}
      {activeTab === "exec" && <ExecView currency={currency} locale={locale} />}

      {/* Funnel Analytics (shared across views) */}
      {showFunnel && <FunnelAnalytics />}

      {/* AI Insights Panel (shared across views) */}
      {showAI && <AIInsightsPanel />}
    </div>
  );
}
