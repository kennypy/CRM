"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/permissions";
import {
  Users,
  Target,
  AlertTriangle,
  Lightbulb,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Activity,
  Award,
  BookOpen,
  Calendar,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Star,
  CheckCircle2,
  FileText,
  BarChart3,
  Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = "high" | "medium" | "low";
type Proficiency = "Beginner" | "Developing" | "Proficient" | "Expert";
type TabKey = "alerts" | "reps" | "meetings" | "skills";

interface CoachingAlert {
  rep: string;
  issue: string;
  severity: Severity;
  suggestion: string;
}

interface RepData {
  id: string;
  name: string;
  role: string;
  winRate: number;
  winRateTarget: number;
  pipeline: number;
  pipelineTarget: number;
  activities: number;
  activitiesTarget: number;
  dealsWon: number;
  dealsWonTarget: number;
  avgDealSize: number;
  trend: "up" | "down" | "flat";
}

interface MeetingNote {
  id: string;
  rep: string;
  date: string;
  topics: string[];
  actionItems: string[];
  status: "completed" | "upcoming" | "overdue";
}

interface SkillEntry {
  rep: string;
  discovery: Proficiency;
  negotiation: Proficiency;
  closing: Proficiency;
  productKnowledge: Proficiency;
  objectionHandling: Proficiency;
}

// ── Demo Data ─────────────────────────────────────────────────────────────────

const TEAM_METRICS = {
  avgWinRate: { value: 56.8, delta: 3.2 },
  avgDealSize: { value: 124000, delta: 8.5 },
  avgCycleTime: { value: 34, delta: -2.1 },
  totalPipeline: { value: 5290000, delta: 12.4 },
};

const COACHING_ALERTS: CoachingAlert[] = [
  { rep: "James Wilson", issue: "Win rate 41% — 14 pts below team target", severity: "high", suggestion: "Review lost deal patterns from last 30 days. Schedule joint discovery calls with Sarah Kim to model best practices." },
  { rep: "Alex Torres", issue: "Pipeline coverage 1.8x — needs 3x for quota", severity: "high", suggestion: "Increase top-of-funnel activity by 40%. Focus prospecting sessions on ICP accounts in technology vertical." },
  { rep: "James Wilson", issue: "Call volume 48/week (team avg 74)", severity: "medium", suggestion: "Set daily call blocks of 90 min. Review time audit to identify low-value activities consuming selling time." },
  { rep: "Priya Sharma", issue: "Meeting-to-close ratio 1:8 (team avg 1:5)", severity: "medium", suggestion: "Tighten qualification criteria using MEDDIC framework before scheduling demos." },
  { rep: "Alex Torres", issue: "Average deal size $68k — 45% below team avg", severity: "medium", suggestion: "Practice value-based selling techniques. Target higher-tier packages in initial proposals." },
  { rep: "Marcus Chen", issue: "Proposal-to-close time 18 days (target 12)", severity: "low", suggestion: "Implement 48-hour follow-up cadence after proposal delivery. Add urgency levers to proposals." },
  { rep: "Sarah Kim", issue: "Discovery call duration 18 min (best practice 30 min)", severity: "low", suggestion: "Expand discovery question framework. Spend more time on pain quantification and business impact." },
];

const REPS: RepData[] = [
  { id: "1", name: "Sarah Kim", role: "Senior AE", winRate: 72, winRateTarget: 55, pipeline: 1420000, pipelineTarget: 1000000, activities: 312, activitiesTarget: 250, dealsWon: 8, dealsWonTarget: 6, avgDealSize: 168000, trend: "up" },
  { id: "2", name: "Marcus Chen", role: "AE", winRate: 63, winRateTarget: 55, pipeline: 980000, pipelineTarget: 1000000, activities: 287, activitiesTarget: 250, dealsWon: 6, dealsWonTarget: 6, avgDealSize: 142000, trend: "up" },
  { id: "3", name: "Priya Sharma", role: "AE", winRate: 57, winRateTarget: 55, pipeline: 870000, pipelineTarget: 1000000, activities: 264, activitiesTarget: 250, dealsWon: 5, dealsWonTarget: 6, avgDealSize: 118000, trend: "flat" },
  { id: "4", name: "Alex Johnson", role: "AE", winRate: 52, winRateTarget: 55, pipeline: 760000, pipelineTarget: 1000000, activities: 231, activitiesTarget: 250, dealsWon: 4, dealsWonTarget: 6, avgDealSize: 105000, trend: "down" },
  { id: "5", name: "James Wilson", role: "AE", winRate: 41, winRateTarget: 55, pipeline: 640000, pipelineTarget: 1000000, activities: 198, activitiesTarget: 250, dealsWon: 3, dealsWonTarget: 6, avgDealSize: 92000, trend: "down" },
  { id: "6", name: "Alex Torres", role: "AE (Ramping)", winRate: 38, winRateTarget: 55, pipeline: 380000, pipelineTarget: 1000000, activities: 145, activitiesTarget: 250, dealsWon: 2, dealsWonTarget: 6, avgDealSize: 68000, trend: "up" },
];

const MEETING_NOTES: MeetingNote[] = [
  { id: "1", rep: "James Wilson", date: "2026-03-06", topics: ["Lost deal analysis", "Call coaching review", "Pipeline building strategy"], actionItems: ["Shadow Sarah Kim on 2 discovery calls by Mar 13", "Complete objection handling workshop", "Add 15 new prospects to pipeline"], status: "completed" },
  { id: "2", rep: "Alex Torres", date: "2026-03-05", topics: ["Ramp progress check-in", "Deal qualification review", "Product knowledge gaps"], actionItems: ["Complete enterprise tier certification", "Present deal strategy for Acme Corp", "Increase daily call target to 18"], status: "completed" },
  { id: "3", rep: "Priya Sharma", date: "2026-03-04", topics: ["Meeting effectiveness", "Qualification framework", "Multi-threading strategy"], actionItems: ["Implement MEDDIC for all deals >$100k", "Identify 2+ stakeholders per deal", "Review demo recording with feedback"], status: "completed" },
  { id: "4", rep: "Marcus Chen", date: "2026-03-03", topics: ["Proposal velocity", "Negotiation tactics", "Q1 goal tracking"], actionItems: ["Create proposal template for faster turnaround", "Complete negotiation skills module", "Schedule mid-quarter pipeline review"], status: "completed" },
  { id: "5", rep: "James Wilson", date: "2026-03-10", topics: ["Weekly progress review", "Call recording review", "Pipeline health check"], actionItems: ["TBD — meeting upcoming"], status: "upcoming" },
  { id: "6", rep: "Alex Torres", date: "2026-03-12", topics: ["Ramp week 7 check-in", "Deal review — Acme Corp", "Activity metrics review"], actionItems: ["TBD — meeting upcoming"], status: "upcoming" },
  { id: "7", rep: "Sarah Kim", date: "2026-03-07", topics: ["Discovery call deep-dive", "Enterprise deal strategy", "Mentorship program feedback"], actionItems: ["Extend discovery calls to 25+ min", "Prepare case study for tech vertical", "Mentor Alex Torres on 1 deal"], status: "overdue" },
];

const SKILL_MATRIX: SkillEntry[] = [
  { rep: "Sarah Kim", discovery: "Expert", negotiation: "Proficient", closing: "Expert", productKnowledge: "Proficient", objectionHandling: "Expert" },
  { rep: "Marcus Chen", discovery: "Proficient", negotiation: "Proficient", closing: "Proficient", productKnowledge: "Expert", objectionHandling: "Developing" },
  { rep: "Priya Sharma", discovery: "Developing", negotiation: "Proficient", closing: "Developing", productKnowledge: "Proficient", objectionHandling: "Proficient" },
  { rep: "Alex Johnson", discovery: "Proficient", negotiation: "Developing", closing: "Developing", productKnowledge: "Developing", objectionHandling: "Proficient" },
  { rep: "James Wilson", discovery: "Developing", negotiation: "Beginner", closing: "Developing", productKnowledge: "Proficient", objectionHandling: "Beginner" },
  { rep: "Alex Torres", discovery: "Beginner", negotiation: "Beginner", closing: "Beginner", productKnowledge: "Developing", objectionHandling: "Developing" },
];

const SKILLS = [
  { key: "discovery" as const, label: "Discovery" },
  { key: "negotiation" as const, label: "Negotiation" },
  { key: "closing" as const, label: "Closing" },
  { key: "productKnowledge" as const, label: "Product Knowledge" },
  { key: "objectionHandling" as const, label: "Objection Handling" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrencyShort(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value}`;
}

function severityStyles(severity: Severity) {
  switch (severity) {
    case "high":
      return {
        border: "border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20",
        badge: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400",
      };
    case "medium":
      return {
        border: "border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20",
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400",
      };
    case "low":
      return {
        border: "border-border bg-muted/20",
        badge: "bg-muted text-muted-foreground",
      };
  }
}

function proficiencyColor(level: Proficiency): string {
  switch (level) {
    case "Expert": return "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-400";
    case "Proficient": return "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400";
    case "Developing": return "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-400";
    case "Beginner": return "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-400";
  }
}

function proficiencyValue(level: Proficiency): number {
  switch (level) {
    case "Expert": return 100;
    case "Proficient": return 75;
    case "Developing": return 50;
    case "Beginner": return 25;
  }
}

// ── Shared Components ─────────────────────────────────────────────────────────

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

function ProgressBar({ value, target, color }: { value: number; target: number; color?: string }) {
  const pct = Math.min((value / target) * 100, 100);
  const isOnTrack = value >= target;
  return (
    <div className="w-full">
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={cn("h-2 rounded-full transition-all", color ?? (isOnTrack ? "bg-green-500" : "bg-amber-500"))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CoachingPage() {
  const permissions = usePermissions();
  const [activeTab, setActiveTab] = useState<TabKey>("alerts");
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null);
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<Severity | "all">("all");
  const [meetingFilter, setMeetingFilter] = useState<"all" | "completed" | "upcoming" | "overdue">("all");

  const filteredAlerts = filterSeverity === "all"
    ? COACHING_ALERTS
    : COACHING_ALERTS.filter((a) => a.severity === filterSeverity);

  const filteredMeetings = meetingFilter === "all"
    ? MEETING_NOTES
    : MEETING_NOTES.filter((m) => m.status === meetingFilter);

  const TABS: { key: TabKey; label: string; icon: React.FC<{ className?: string }>; count?: number }[] = [
    { key: "alerts", label: "Coaching Alerts", icon: AlertTriangle, count: COACHING_ALERTS.filter((a) => a.severity === "high").length },
    { key: "reps", label: "Rep Performance", icon: Users },
    { key: "meetings", label: "1:1 Notes", icon: MessageSquare },
    { key: "skills", label: "Skill Matrix", icon: BookOpen },
  ];

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Coaching Hub</h1>
            <p className="text-xs text-muted-foreground">
              Track rep development, review coaching alerts, and drive team performance
            </p>
          </div>
        </div>
      </div>

      {/* Team Performance Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Avg Win Rate</p>
              <p className="mt-1 text-xl font-bold">{TEAM_METRICS.avgWinRate.value}%</p>
            </div>
            <div className="rounded-lg p-2 shrink-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <Target className="h-4 w-4" />
            </div>
          </div>
          <div className={cn("mt-2 flex items-center gap-1 text-xs font-medium",
            TEAM_METRICS.avgWinRate.delta >= 0 ? "text-green-600" : "text-red-600")}>
            {TEAM_METRICS.avgWinRate.delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {TEAM_METRICS.avgWinRate.delta >= 0 ? "+" : ""}{TEAM_METRICS.avgWinRate.delta}% vs last month
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Avg Deal Size</p>
              <p className="mt-1 text-xl font-bold">{formatCurrencyShort(TEAM_METRICS.avgDealSize.value)}</p>
            </div>
            <div className="rounded-lg p-2 shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className={cn("mt-2 flex items-center gap-1 text-xs font-medium",
            TEAM_METRICS.avgDealSize.delta >= 0 ? "text-green-600" : "text-red-600")}>
            <TrendingUp className="h-3 w-3" />
            +{TEAM_METRICS.avgDealSize.delta}% vs last month
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Avg Cycle Time</p>
              <p className="mt-1 text-xl font-bold">{TEAM_METRICS.avgCycleTime.value} days</p>
            </div>
            <div className="rounded-lg p-2 shrink-0 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className={cn("mt-2 flex items-center gap-1 text-xs font-medium",
            TEAM_METRICS.avgCycleTime.delta <= 0 ? "text-green-600" : "text-red-600")}>
            <TrendingDown className="h-3 w-3" />
            {TEAM_METRICS.avgCycleTime.delta} days vs last month
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Total Pipeline</p>
              <p className="mt-1 text-xl font-bold">{formatCurrencyShort(TEAM_METRICS.totalPipeline.value)}</p>
            </div>
            <div className="rounded-lg p-2 shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <BarChart3 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs font-medium text-green-600">
            <TrendingUp className="h-3 w-3" />
            +{TEAM_METRICS.totalPipeline.delta}% vs last month
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {TABS.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              activeTab === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {count != null && count > 0 && (
              <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/50 dark:text-red-400">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "alerts" && (
        <div className="space-y-5">
          {/* Severity Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Filter:</span>
            {(["all", "high", "medium", "low"] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setFilterSeverity(sev)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  filterSeverity === sev
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {sev === "all" ? "All" : sev.charAt(0).toUpperCase() + sev.slice(1)}
                {sev !== "all" && (
                  <span className="ml-1">({COACHING_ALERTS.filter((a) => a.severity === sev).length})</span>
                )}
              </button>
            ))}
          </div>

          {/* Alert Cards */}
          <div className="rounded-xl border bg-card p-5">
            <SectionHeader title="Active Coaching Alerts" icon={AlertTriangle} />
            <div className="space-y-3">
              {filteredAlerts.map((alert, i) => {
                const styles = severityStyles(alert.severity);
                const isExpanded = expandedAlert === i;
                return (
                  <div
                    key={i}
                    className={cn("rounded-lg border p-3 transition-colors cursor-pointer", styles.border)}
                    onClick={() => setExpandedAlert(isExpanded ? null : i)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium">{alert.rep}</span>
                          <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-medium", styles.badge)}>
                            {alert.severity}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{alert.issue}</p>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-start gap-1.5">
                          <Lightbulb className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-medium text-foreground mb-1">AI Suggestion</p>
                            <p className="text-xs text-muted-foreground">{alert.suggestion}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredAlerts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No alerts matching this filter.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "reps" && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {REPS.map((rep) => (
              <div key={rep.id} className="rounded-xl border bg-card p-5 transition-shadow hover:shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold">{rep.name}</h3>
                    <p className="text-xs text-muted-foreground">{rep.role}</p>
                  </div>
                  <div className={cn("flex items-center gap-1 text-xs font-medium",
                    rep.trend === "up" ? "text-green-600" :
                    rep.trend === "down" ? "text-red-600" :
                    "text-muted-foreground"
                  )}>
                    {rep.trend === "up" && <TrendingUp className="h-3 w-3" />}
                    {rep.trend === "down" && <TrendingDown className="h-3 w-3" />}
                    {rep.trend === "flat" && <Activity className="h-3 w-3" />}
                    {rep.trend === "up" ? "Trending Up" : rep.trend === "down" ? "Needs Attention" : "Steady"}
                  </div>
                </div>

                <div className="space-y-3">
                  {/* Win Rate */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Win Rate</span>
                      <span className={cn("text-xs font-semibold tabular-nums",
                        rep.winRate >= rep.winRateTarget ? "text-green-600" : "text-red-600")}>
                        {rep.winRate}% <span className="font-normal text-muted-foreground">/ {rep.winRateTarget}%</span>
                      </span>
                    </div>
                    <ProgressBar value={rep.winRate} target={rep.winRateTarget} />
                  </div>

                  {/* Pipeline */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Pipeline</span>
                      <span className={cn("text-xs font-semibold tabular-nums",
                        rep.pipeline >= rep.pipelineTarget ? "text-green-600" : "text-amber-600")}>
                        {formatCurrencyShort(rep.pipeline)} <span className="font-normal text-muted-foreground">/ {formatCurrencyShort(rep.pipelineTarget)}</span>
                      </span>
                    </div>
                    <ProgressBar value={rep.pipeline} target={rep.pipelineTarget} />
                  </div>

                  {/* Activities */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Activities</span>
                      <span className={cn("text-xs font-semibold tabular-nums",
                        rep.activities >= rep.activitiesTarget ? "text-green-600" : "text-amber-600")}>
                        {rep.activities} <span className="font-normal text-muted-foreground">/ {rep.activitiesTarget}</span>
                      </span>
                    </div>
                    <ProgressBar value={rep.activities} target={rep.activitiesTarget} />
                  </div>

                  {/* Deals Won */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Deals Won</span>
                      <span className={cn("text-xs font-semibold tabular-nums",
                        rep.dealsWon >= rep.dealsWonTarget ? "text-green-600" : "text-amber-600")}>
                        {rep.dealsWon} <span className="font-normal text-muted-foreground">/ {rep.dealsWonTarget}</span>
                      </span>
                    </div>
                    <ProgressBar value={rep.dealsWon} target={rep.dealsWonTarget} />
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Avg Deal Size</span>
                  <span className="text-sm font-semibold">{formatCurrencyShort(rep.avgDealSize)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "meetings" && (
        <div className="space-y-5">
          {/* Meeting Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            {(["all", "upcoming", "completed", "overdue"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setMeetingFilter(status)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  meetingFilter === status
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          <div className="rounded-xl border bg-card p-5">
            <SectionHeader title="1:1 Meeting Notes" icon={FileText} />
            <div className="space-y-3">
              {filteredMeetings.map((note) => {
                const isExpanded = expandedMeeting === note.id;
                return (
                  <div
                    key={note.id}
                    className={cn(
                      "rounded-lg border p-3 transition-colors cursor-pointer",
                      note.status === "overdue" ? "border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20" :
                      note.status === "upcoming" ? "border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/20" :
                      "border-border bg-muted/20"
                    )}
                    onClick={() => setExpandedMeeting(isExpanded ? null : note.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium">{note.rep}</span>
                          <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-medium",
                            note.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400" :
                            note.status === "upcoming" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400" :
                            "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400"
                          )}>
                            {note.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <Calendar className="inline h-3 w-3 mr-1" />
                          {note.date}
                        </p>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                        <div>
                          <p className="text-xs font-medium text-foreground mb-1.5">Topics Discussed</p>
                          <ul className="space-y-1">
                            {note.topics.map((topic, j) => (
                              <li key={j} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <MessageSquare className="h-3 w-3 shrink-0" />
                                {topic}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-foreground mb-1.5">Action Items</p>
                          <ul className="space-y-1">
                            {note.actionItems.map((item, j) => (
                              <li key={j} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredMeetings.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No meetings matching this filter.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "skills" && (
        <div className="space-y-5">
          <div className="rounded-xl border bg-card p-5">
            <SectionHeader title="Skill Development Matrix" icon={BookOpen} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Rep</th>
                    {SKILLS.map((skill) => (
                      <th key={skill.key} className="text-center py-2 px-2 text-xs font-medium text-muted-foreground">
                        {skill.label}
                      </th>
                    ))}
                    <th className="text-center py-2 pl-4 text-xs font-medium text-muted-foreground">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {SKILL_MATRIX.map((entry, i) => {
                    const avgScore = Math.round(
                      SKILLS.reduce((sum, skill) => sum + proficiencyValue(entry[skill.key]), 0) / SKILLS.length
                    );
                    return (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="py-3 pr-4">
                          <span className="text-sm font-medium">{entry.rep}</span>
                        </td>
                        {SKILLS.map((skill) => (
                          <td key={skill.key} className="py-3 px-2 text-center">
                            <span className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                              proficiencyColor(entry[skill.key])
                            )}>
                              {entry[skill.key]}
                            </span>
                          </td>
                        ))}
                        <td className="py-3 pl-4">
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-2 w-16 rounded-full bg-muted">
                              <div
                                className={cn("h-2 rounded-full",
                                  avgScore >= 75 ? "bg-green-500" :
                                  avgScore >= 50 ? "bg-blue-500" :
                                  avgScore >= 35 ? "bg-amber-500" : "bg-red-500"
                                )}
                                style={{ width: `${avgScore}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium tabular-nums text-muted-foreground">{avgScore}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center gap-4 flex-wrap">
              <span className="text-xs text-muted-foreground">Proficiency Levels:</span>
              {(["Beginner", "Developing", "Proficient", "Expert"] as Proficiency[]).map((level) => (
                <span key={level} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", proficiencyColor(level))}>
                  {level}
                </span>
              ))}
            </div>
          </div>

          {/* Skill Gap Summary */}
          <div className="rounded-xl border bg-card p-5">
            <SectionHeader title="Priority Skill Gaps" icon={Zap} />
            <div className="space-y-3">
              {[
                { skill: "Negotiation", reps: "James Wilson, Alex Torres", impact: "Directly impacts deal size and discount rates. Team avg deal size 15% below industry benchmark.", priority: "high" as const },
                { skill: "Closing", reps: "Alex Torres, Alex Johnson, Priya Sharma", impact: "3 reps below proficient. Correlates with team win rate gap vs. target.", priority: "high" as const },
                { skill: "Discovery", reps: "James Wilson, Alex Torres", impact: "Weak discovery leads to poor qualification. These reps have the lowest meeting-to-close ratios.", priority: "medium" as const },
                { skill: "Objection Handling", reps: "James Wilson, Marcus Chen", impact: "Late-stage deal loss pattern suggests objection handling gaps in competitive situations.", priority: "medium" as const },
              ].map((gap, i) => (
                <div key={i} className={cn("rounded-lg border p-3",
                  gap.priority === "high"
                    ? "border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20"
                    : "border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20"
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    <Star className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-medium">{gap.skill}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-medium",
                      gap.priority === "high"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
                    )}>
                      {gap.priority} priority
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">
                    <span className="font-medium">Reps:</span> {gap.reps}
                  </p>
                  <p className="text-xs text-muted-foreground">{gap.impact}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
