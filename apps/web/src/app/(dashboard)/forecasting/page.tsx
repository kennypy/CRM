"use client";

/**
 * Forecasting — Enterprise forecast management with AI overrides,
 * historical tracking, deal inspection, and submission workflows.
 *
 * Currency: always uses tenant.defaultCurrency from TenantContext.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { usePermissions } from "@/lib/permissions";
import {
  Target,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  MessageSquare,
  ArrowUp,
  ArrowDown,
  Brain,
  BarChart3,
  Filter,
  RefreshCw,
  X,
  Shield,
  Users,
  Minus,
  Loader2,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

type ForecastCategory = "closed" | "commit" | "best_case" | "pipeline" | "omitted";
type ForecastStatus = "draft" | "submitted" | "approved" | "final";
type TimePeriod = "current_quarter" | "next_quarter" | "monthly" | "custom";
type RiskLevel = "on_track" | "at_risk" | "exceeding";

interface ForecastDeal {
  id: string;
  name: string;
  value: number;
  currency?: string;
  category: ForecastCategory;
  stage: string;
  closeDate: string;
  ownerName: string;
  ownerId: string;
  company: string;
  realityScore: number;
  repProbability: number;
  aiProbability: number;
  lastActivity: string;
  daysSinceActivity: number;
  hasMultipleStakeholders: boolean;
  nextStep: string | null;
  movement: "up" | "down" | "stable";
  previousCategory: ForecastCategory | null;
  riskFlags: string[];
}

interface RepForecast {
  id: string;
  repId: string;
  repName: string;
  role: "rep" | "manager";
  managerId: string | null;
  quota: number;
  closedWon: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  omitted: number;
  gapToQuota: number;
  aiCommit: number;
  aiBestCase: number;
  aiPipeline: number;
  forecastAccuracy: number;
  status: ForecastStatus;
  submittedAt: string | null;
  notes: string;
  directReports?: RepForecast[];
}

interface ForecastSnapshot {
  weekLabel: string;
  commit: number;
  bestCase: number;
  pipeline: number;
  closedWon: number;
}

interface HistoricalQuarter {
  quarter: string;
  forecastedCommit: number;
  actualClose: number;
  accuracy: number;
}

interface ForecastComment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

// ── Demo Data ───────────────────────────────────────────────────────────────

const DEMO_DEALS: ForecastDeal[] = [
  { id: "d1", name: "Acme Corp - Platform License", value: 185000, category: "commit", stage: "negotiation", closeDate: "2026-03-28", ownerName: "Sarah Chen", ownerId: "r1", company: "Acme Corp", realityScore: 82, repProbability: 90, aiProbability: 78, lastActivity: "2026-03-06", daysSinceActivity: 2, hasMultipleStakeholders: true, nextStep: "Legal review in progress", movement: "stable", previousCategory: null, riskFlags: [] },
  { id: "d2", name: "GlobalTech - Enterprise Suite", value: 320000, category: "commit", stage: "negotiation", closeDate: "2026-03-25", ownerName: "Sarah Chen", ownerId: "r1", company: "GlobalTech", realityScore: 74, repProbability: 85, aiProbability: 68, lastActivity: "2026-03-01", daysSinceActivity: 7, hasMultipleStakeholders: true, nextStep: "Contract sent", movement: "stable", previousCategory: "best_case", riskFlags: ["No activity in 7 days"] },
  { id: "d3", name: "Meridian Health - Analytics", value: 95000, category: "best_case", stage: "proposal", closeDate: "2026-03-31", ownerName: "Sarah Chen", ownerId: "r1", company: "Meridian Health", realityScore: 55, repProbability: 70, aiProbability: 48, lastActivity: "2026-03-04", daysSinceActivity: 4, hasMultipleStakeholders: false, nextStep: "Demo scheduled Mar 12", movement: "up", previousCategory: "pipeline", riskFlags: ["Single-threaded"] },
  { id: "d4", name: "Pinnacle Fin - Compliance Module", value: 210000, category: "commit", stage: "negotiation", closeDate: "2026-03-20", ownerName: "James Park", ownerId: "r2", company: "Pinnacle Financial", realityScore: 88, repProbability: 95, aiProbability: 85, lastActivity: "2026-03-07", daysSinceActivity: 1, hasMultipleStakeholders: true, nextStep: "Procurement approval expected", movement: "stable", previousCategory: null, riskFlags: [] },
  { id: "d5", name: "Nordic Retail - POS Integration", value: 145000, category: "best_case", stage: "proposal", closeDate: "2026-03-31", ownerName: "James Park", ownerId: "r2", company: "Nordic Retail", realityScore: 62, repProbability: 75, aiProbability: 58, lastActivity: "2026-03-05", daysSinceActivity: 3, hasMultipleStakeholders: true, nextStep: "Technical validation", movement: "down", previousCategory: "commit", riskFlags: ["Champion went silent", "Budget reallocation risk"] },
  { id: "d6", name: "Skyline Media - Content Platform", value: 78000, category: "pipeline", stage: "discovery", closeDate: "2026-03-31", ownerName: "James Park", ownerId: "r2", company: "Skyline Media", realityScore: 35, repProbability: 40, aiProbability: 28, lastActivity: "2026-02-28", daysSinceActivity: 8, hasMultipleStakeholders: false, nextStep: null, movement: "stable", previousCategory: null, riskFlags: ["No activity in 7+ days", "Single-threaded", "No next step defined"] },
  { id: "d7", name: "Vertex Labs - R&D License", value: 250000, category: "best_case", stage: "proposal", closeDate: "2026-03-30", ownerName: "Maria Lopez", ownerId: "r3", company: "Vertex Labs", realityScore: 65, repProbability: 80, aiProbability: 60, lastActivity: "2026-03-06", daysSinceActivity: 2, hasMultipleStakeholders: true, nextStep: "Exec sponsor meeting Mar 15", movement: "up", previousCategory: "pipeline", riskFlags: [] },
  { id: "d8", name: "Quantum Dynamics - Infrastructure", value: 175000, category: "commit", stage: "negotiation", closeDate: "2026-03-22", ownerName: "Maria Lopez", ownerId: "r3", company: "Quantum Dynamics", realityScore: 79, repProbability: 90, aiProbability: 75, lastActivity: "2026-03-07", daysSinceActivity: 1, hasMultipleStakeholders: true, nextStep: "Final pricing review", movement: "stable", previousCategory: null, riskFlags: [] },
  { id: "d9", name: "Atlas Shipping - Logistics Module", value: 88000, category: "pipeline", stage: "discovery", closeDate: "2026-03-31", ownerName: "Maria Lopez", ownerId: "r3", company: "Atlas Shipping", realityScore: 30, repProbability: 35, aiProbability: 22, lastActivity: "2026-02-25", daysSinceActivity: 11, hasMultipleStakeholders: false, nextStep: null, movement: "down", previousCategory: "best_case", riskFlags: ["No activity in 10+ days", "Single-threaded", "No next step defined", "Close date at risk"] },
  { id: "d10", name: "Elevate Education - LMS", value: 130000, category: "omitted", stage: "discovery", closeDate: "2026-04-15", ownerName: "James Park", ownerId: "r2", company: "Elevate Education", realityScore: 18, repProbability: 20, aiProbability: 12, lastActivity: "2026-02-15", daysSinceActivity: 21, hasMultipleStakeholders: false, nextStep: null, movement: "down", previousCategory: "pipeline", riskFlags: ["No activity in 21 days", "Single-threaded", "No next step", "Close date past quarter"] },
  { id: "d11", name: "Acme Corp - Addon Seats", value: 42000, category: "closed", stage: "closed_won", closeDate: "2026-03-02", ownerName: "Sarah Chen", ownerId: "r1", company: "Acme Corp", realityScore: 100, repProbability: 100, aiProbability: 100, lastActivity: "2026-03-02", daysSinceActivity: 6, hasMultipleStakeholders: true, nextStep: null, movement: "stable", previousCategory: "commit", riskFlags: [] },
  { id: "d12", name: "Pinnacle Fin - Phase 1", value: 95000, category: "closed", stage: "closed_won", closeDate: "2026-03-05", ownerName: "James Park", ownerId: "r2", company: "Pinnacle Financial", realityScore: 100, repProbability: 100, aiProbability: 100, lastActivity: "2026-03-05", daysSinceActivity: 3, hasMultipleStakeholders: true, nextStep: null, movement: "stable", previousCategory: "commit", riskFlags: [] },
  { id: "d13", name: "Vertex Labs - Pilot Extension", value: 65000, category: "closed", stage: "closed_won", closeDate: "2026-03-01", ownerName: "Maria Lopez", ownerId: "r3", company: "Vertex Labs", realityScore: 100, repProbability: 100, aiProbability: 100, lastActivity: "2026-03-01", daysSinceActivity: 7, hasMultipleStakeholders: true, nextStep: null, movement: "stable", previousCategory: "commit", riskFlags: [] },
];

const DEMO_REP_FORECASTS: RepForecast[] = [
  {
    id: "f1", repId: "r1", repName: "Sarah Chen", role: "rep", managerId: "m1",
    quota: 750000, closedWon: 42000, commit: 505000, bestCase: 95000, pipeline: 0, omitted: 0,
    gapToQuota: 750000 - 42000 - 505000, aiCommit: 438000, aiBestCase: 78000, aiPipeline: 0,
    forecastAccuracy: 87, status: "submitted", submittedAt: "2026-03-07T14:30:00Z",
    notes: "GlobalTech contract in legal review, expecting signature by Mar 25.",
    directReports: undefined,
  },
  {
    id: "f2", repId: "r2", repName: "James Park", role: "rep", managerId: "m1",
    quota: 700000, closedWon: 95000, commit: 210000, bestCase: 145000, pipeline: 78000, omitted: 130000,
    gapToQuota: 700000 - 95000 - 210000, aiCommit: 185000, aiBestCase: 108000, aiPipeline: 52000,
    forecastAccuracy: 72, status: "draft", submittedAt: null,
    notes: "",
    directReports: undefined,
  },
  {
    id: "f3", repId: "r3", repName: "Maria Lopez", role: "rep", managerId: "m1",
    quota: 650000, closedWon: 65000, commit: 175000, bestCase: 250000, pipeline: 88000, omitted: 0,
    gapToQuota: 650000 - 65000 - 175000, aiCommit: 148000, aiBestCase: 195000, aiPipeline: 58000,
    forecastAccuracy: 81, status: "submitted", submittedAt: "2026-03-07T16:00:00Z",
    notes: "Vertex exec meeting on Mar 15 could accelerate.",
    directReports: undefined,
  },
];

const DEMO_MANAGER_FORECAST: RepForecast = {
  id: "fm1", repId: "m1", repName: "Alex Rivera", role: "manager", managerId: null,
  quota: 2100000,
  closedWon: 42000 + 95000 + 65000,
  commit: 505000 + 210000 + 175000,
  bestCase: 95000 + 145000 + 250000,
  pipeline: 0 + 78000 + 88000,
  omitted: 0 + 130000 + 0,
  gapToQuota: 2100000 - (42000 + 95000 + 65000) - (505000 + 210000 + 175000),
  aiCommit: 438000 + 185000 + 148000,
  aiBestCase: 78000 + 108000 + 195000,
  aiPipeline: 0 + 52000 + 58000,
  forecastAccuracy: 80,
  status: "submitted",
  submittedAt: "2026-03-07T18:00:00Z",
  notes: "Team tracking well. James needs coaching on pipeline hygiene.",
  directReports: DEMO_REP_FORECASTS,
};

const DEMO_SNAPSHOTS: ForecastSnapshot[] = [
  { weekLabel: "Week 1 (Jan 5)", commit: 620000, bestCase: 380000, pipeline: 450000, closedWon: 0 },
  { weekLabel: "Week 2 (Jan 12)", commit: 650000, bestCase: 410000, pipeline: 420000, closedWon: 28000 },
  { weekLabel: "Week 3 (Jan 19)", commit: 680000, bestCase: 390000, pipeline: 380000, closedWon: 55000 },
  { weekLabel: "Week 4 (Jan 26)", commit: 710000, bestCase: 380000, pipeline: 340000, closedWon: 82000 },
  { weekLabel: "Week 5 (Feb 2)", commit: 730000, bestCase: 400000, pipeline: 300000, closedWon: 110000 },
  { weekLabel: "Week 6 (Feb 9)", commit: 750000, bestCase: 420000, pipeline: 280000, closedWon: 135000 },
  { weekLabel: "Week 7 (Feb 16)", commit: 780000, bestCase: 430000, pipeline: 250000, closedWon: 155000 },
  { weekLabel: "Week 8 (Feb 23)", commit: 810000, bestCase: 450000, pipeline: 220000, closedWon: 170000 },
  { weekLabel: "Week 9 (Mar 2)", commit: 840000, bestCase: 460000, pipeline: 190000, closedWon: 182000 },
  { weekLabel: "Week 10 (Mar 9)", commit: 890000, bestCase: 490000, pipeline: 166000, closedWon: 202000 },
];

const DEMO_HISTORICAL: HistoricalQuarter[] = [
  { quarter: "Q1 2025", forecastedCommit: 1800000, actualClose: 1620000, accuracy: 90 },
  { quarter: "Q2 2025", forecastedCommit: 2100000, actualClose: 1785000, accuracy: 85 },
  { quarter: "Q3 2025", forecastedCommit: 2300000, actualClose: 2185000, accuracy: 95 },
  { quarter: "Q4 2025", forecastedCommit: 2500000, actualClose: 2175000, accuracy: 87 },
];

const DEMO_CHANGELOG: { date: string; change: string; user: string }[] = [
  { date: "2026-03-08", change: "Nordic Retail moved from Commit to Best Case (-$145K commit)", user: "James Park" },
  { date: "2026-03-07", change: "Meridian Health moved from Pipeline to Best Case (+$95K best case)", user: "Sarah Chen" },
  { date: "2026-03-07", change: "Manager rollup submitted for Q1 review", user: "Alex Rivera" },
  { date: "2026-03-06", change: "Atlas Shipping flagged at risk - no activity 10+ days", user: "System" },
  { date: "2026-03-05", change: "Pinnacle Fin Phase 1 closed won ($95K)", user: "James Park" },
  { date: "2026-03-04", change: "Vertex Labs moved from Pipeline to Best Case (+$250K best case)", user: "Maria Lopez" },
  { date: "2026-03-03", change: "Elevate Education moved to Omitted - stalled deal", user: "James Park" },
  { date: "2026-03-02", change: "Acme Corp Addon Seats closed won ($42K)", user: "Sarah Chen" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function getQuarterLabel(period: TimePeriod): string {
  if (period === "current_quarter") return "Q1 2026";
  if (period === "next_quarter") return "Q2 2026";
  if (period === "monthly") return "March 2026";
  return "Custom Range";
}

function getQuarterDeadline(period: TimePeriod): string {
  if (period === "current_quarter") return "2026-03-31";
  if (period === "next_quarter") return "2026-06-30";
  if (period === "monthly") return "2026-03-31";
  return "2026-03-31";
}

function daysUntil(dateStr: string): number {
  const now = new Date("2026-03-08");
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

function getRiskLevel(forecast: RepForecast): RiskLevel {
  const coverage = (forecast.closedWon + forecast.commit) / forecast.quota;
  if (coverage >= 1.0) return "exceeding";
  if (coverage >= 0.7) return "on_track";
  return "at_risk";
}

function riskBadgeClasses(level: RiskLevel): string {
  if (level === "exceeding") return "bg-green-100 text-green-700 border-green-200";
  if (level === "on_track") return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function riskLabel(level: RiskLevel): string {
  if (level === "exceeding") return "Exceeding";
  if (level === "on_track") return "On Track";
  return "At Risk";
}

function statusBadgeClasses(status: ForecastStatus): string {
  switch (status) {
    case "draft": return "bg-gray-100 text-gray-600 border-gray-200";
    case "submitted": return "bg-blue-100 text-blue-700 border-blue-200";
    case "approved": return "bg-green-100 text-green-700 border-green-200";
    case "final": return "bg-purple-100 text-purple-700 border-purple-200";
  }
}

function categoryColor(cat: ForecastCategory): string {
  switch (cat) {
    case "closed": return "bg-green-500";
    case "commit": return "bg-blue-500";
    case "best_case": return "bg-yellow-500";
    case "pipeline": return "bg-gray-400";
    case "omitted": return "bg-red-400";
  }
}

function categoryLabel(cat: ForecastCategory): string {
  switch (cat) {
    case "closed": return "Closed Won";
    case "commit": return "Commit";
    case "best_case": return "Best Case";
    case "pipeline": return "Pipeline";
    case "omitted": return "Omitted";
  }
}

// ── Forecast Summary Cards ──────────────────────────────────────────────────

function SummaryCards({
  forecasts,
  currency,
  locale,
}: {
  forecasts: RepForecast[];
  currency: string;
  locale: string;
}) {
  const totalQuota = forecasts.reduce((s, f) => s + f.quota, 0);
  const totalClosed = forecasts.reduce((s, f) => s + f.closedWon, 0);
  const totalCommit = forecasts.reduce((s, f) => s + f.commit, 0);
  const totalBestCase = forecasts.reduce((s, f) => s + f.bestCase, 0);
  const totalPipeline = forecasts.reduce((s, f) => s + f.pipeline, 0);
  const weightedPipeline =
    totalCommit * 0.9 + totalBestCase * 0.6 + totalPipeline * 0.3;
  const gap = totalQuota - totalClosed - totalCommit;
  const coverage = totalQuota > 0
    ? (totalClosed + totalCommit + totalBestCase + totalPipeline) / totalQuota
    : 0;

  const cards = [
    { label: "Total Pipeline", value: totalClosed + totalCommit + totalBestCase + totalPipeline, icon: BarChart3, accent: "text-foreground" },
    { label: "Weighted Pipeline", value: weightedPipeline, icon: Target, accent: "text-foreground" },
    { label: "Commit", value: totalCommit, icon: Shield, accent: "text-blue-600" },
    { label: "Best Case", value: totalBestCase, icon: TrendingUp, accent: "text-yellow-600" },
    { label: "Closed Won", value: totalClosed, icon: CheckCircle2, accent: "text-green-600" },
    { label: "Gap to Quota", value: gap, icon: gap > 0 ? AlertTriangle : CheckCircle2, accent: gap > 0 ? "text-red-600" : "text-green-600" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border bg-card px-4 py-3 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <card.icon className={cn("h-4 w-4", card.accent)} />
            <p className="text-xs text-muted-foreground">{card.label}</p>
          </div>
          <p className={cn("mt-1 text-lg font-bold tabular-nums", card.accent)}>
            {formatCurrency(Math.abs(card.value), currency, true, locale)}
            {card.label === "Gap to Quota" && card.value > 0 && (
              <span className="ml-1 text-xs font-normal">behind</span>
            )}
          </p>
        </div>
      ))}
      <div className="col-span-2 rounded-lg border bg-card px-4 py-3 shadow-sm md:col-span-3 xl:col-span-6">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Coverage Ratio (Pipeline / Quota)
          </span>
          <span className={cn(
            "text-sm font-bold tabular-nums",
            coverage >= 3 ? "text-green-600" : coverage >= 2 ? "text-blue-600" : coverage >= 1 ? "text-yellow-600" : "text-red-600",
          )}>
            {coverage.toFixed(1)}x
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              coverage >= 3 ? "bg-green-500" : coverage >= 2 ? "bg-blue-500" : coverage >= 1 ? "bg-yellow-500" : "bg-red-500",
            )}
            style={{ width: `${Math.min(coverage / 4 * 100, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Forecast Rollup Table ───────────────────────────────────────────────────

function ForecastRow({
  forecast,
  currency,
  locale,
  isManager,
  isExpanded,
  onToggle,
  onInspect,
  depth = 0,
}: {
  forecast: RepForecast;
  currency: string;
  locale: string;
  isManager: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onInspect: (repId: string, repName: string) => void;
  depth?: number;
}) {
  const risk = getRiskLevel(forecast);
  const commitVariance = forecast.commit - forecast.aiCommit;
  const commitVariancePct =
    forecast.aiCommit > 0
      ? ((commitVariance / forecast.aiCommit) * 100).toFixed(0)
      : "0";

  return (
    <tr
      className={cn(
        "border-b border-border/50 transition-colors hover:bg-muted/30",
        depth > 0 && "bg-muted/10",
      )}
    >
      <td className="px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
          {isManager ? (
            <button onClick={onToggle} className="flex items-center gap-1 font-semibold text-foreground hover:text-primary">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              {forecast.repName}
            </button>
          ) : (
            <span className="font-medium text-foreground">{forecast.repName}</span>
          )}
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", riskBadgeClasses(risk))}>
            {riskLabel(risk)}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", statusBadgeClasses(forecast.status))}>
            {forecast.status}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">
        {formatCurrency(forecast.quota, currency, true, locale)}
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium text-green-600">
        {formatCurrency(forecast.closedWon, currency, true, locale)}
      </td>
      <td className="px-3 py-2.5 text-right text-sm">
        <button
          onClick={() => onInspect(forecast.repId, forecast.repName)}
          className="tabular-nums font-medium text-blue-600 hover:underline"
        >
          {formatCurrency(forecast.commit, currency, true, locale)}
        </button>
        <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          <Brain className="h-3 w-3" />
          {formatCurrency(forecast.aiCommit, currency, true, locale)}
          <span className={cn(
            "font-medium",
            commitVariance > 0 ? "text-yellow-600" : commitVariance < 0 ? "text-green-600" : "text-muted-foreground",
          )}>
            ({commitVariance > 0 ? "+" : ""}{commitVariancePct}%)
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium text-yellow-600">
        {formatCurrency(forecast.bestCase, currency, true, locale)}
        <div className="text-[10px] text-muted-foreground">
          <Brain className="mr-0.5 inline h-3 w-3" />
          {formatCurrency(forecast.aiBestCase, currency, true, locale)}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">
        {formatCurrency(forecast.pipeline, currency, true, locale)}
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums">
        <span className={cn("font-medium", forecast.gapToQuota > 0 ? "text-red-600" : "text-green-600")}>
          {forecast.gapToQuota > 0 ? "-" : "+"}
          {formatCurrency(Math.abs(forecast.gapToQuota), currency, true, locale)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center text-sm">
        <span className={cn(
          "tabular-nums font-medium",
          forecast.forecastAccuracy >= 90 ? "text-green-600" :
          forecast.forecastAccuracy >= 75 ? "text-yellow-600" : "text-red-600",
        )}>
          {forecast.forecastAccuracy}%
        </span>
      </td>
    </tr>
  );
}

function RollupTable({
  manager,
  currency,
  locale,
  onInspect,
}: {
  manager: RepForecast;
  currency: string;
  locale: string;
  onInspect: (repId: string, repName: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Rep / Team</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Quota</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Closed Won</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">
              Commit
              <span className="block font-normal text-[10px]">AI Forecast</span>
            </th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">
              Best Case
              <span className="block font-normal text-[10px]">AI Forecast</span>
            </th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Pipeline</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Gap to Quota</th>
            <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          <ForecastRow
            forecast={manager}
            currency={currency}
            locale={locale}
            isManager={true}
            isExpanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            onInspect={onInspect}
          />
          {expanded &&
            manager.directReports?.map((rep) => (
              <ForecastRow
                key={rep.id}
                forecast={rep}
                currency={currency}
                locale={locale}
                isManager={false}
                isExpanded={false}
                onToggle={() => {}}
                onInspect={onInspect}
                depth={1}
              />
            ))}
        </tbody>
      </table>
    </div>
  );
}

// ── AI Override Panel ────────────────────────────────────────────────────────

function AIOverridePanel({
  forecasts,
  currency,
  locale,
}: {
  forecasts: RepForecast[];
  currency: string;
  locale: string;
}) {
  const totalRepCommit = forecasts.reduce((s, f) => s + f.commit, 0);
  const totalAICommit = forecasts.reduce((s, f) => s + f.aiCommit, 0);
  const totalRepBest = forecasts.reduce((s, f) => s + f.bestCase, 0);
  const totalAIBest = forecasts.reduce((s, f) => s + f.aiBestCase, 0);
  const commitDelta = totalRepCommit - totalAICommit;
  const bestDelta = totalRepBest - totalAIBest;

  const adjustments = [
    {
      rep: "James Park",
      deal: "Nordic Retail - POS Integration",
      repCategory: "Best Case" as const,
      aiRecommendation: "Pipeline" as const,
      reason: "Champion has gone silent for 3 days. Budget reallocation signals detected in last email. Similar deals at this stage historically close at 35% rate.",
      confidence: 72,
      impact: -145000,
    },
    {
      rep: "Maria Lopez",
      deal: "Atlas Shipping - Logistics Module",
      repCategory: "Pipeline" as const,
      aiRecommendation: "Omitted" as const,
      reason: "No activity in 11 days. Single-threaded with no exec sponsor. No defined next steps. Deals with these signals close at <8% rate.",
      confidence: 88,
      impact: -88000,
    },
    {
      rep: "Sarah Chen",
      deal: "GlobalTech - Enterprise Suite",
      repCategory: "Commit" as const,
      aiRecommendation: "Best Case" as const,
      reason: "7 days without activity while in legal review. Historical pattern shows 68% of deals stall 15+ days in legal. Consider downgrading until activity resumes.",
      confidence: 65,
      impact: -320000,
    },
  ];

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500" />
          <h3 className="text-sm font-semibold">AI Forecast Override Analysis</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Reality Score-based predictions alongside rep forecasts
        </p>
      </div>
      <div className="p-4">
        {/* Summary variance */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">Commit Variance (Rep vs AI)</p>
            <p className={cn("mt-1 text-lg font-bold tabular-nums", commitDelta > 0 ? "text-yellow-600" : "text-green-600")}>
              {commitDelta > 0 ? "+" : ""}{formatCurrency(commitDelta, currency, true, locale)}
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Rep: {formatCurrency(totalRepCommit, currency, true, locale)}</span>
              <Minus className="h-3 w-3" />
              <span>AI: {formatCurrency(totalAICommit, currency, true, locale)}</span>
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">Best Case Variance (Rep vs AI)</p>
            <p className={cn("mt-1 text-lg font-bold tabular-nums", bestDelta > 0 ? "text-yellow-600" : "text-green-600")}>
              {bestDelta > 0 ? "+" : ""}{formatCurrency(bestDelta, currency, true, locale)}
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Rep: {formatCurrency(totalRepBest, currency, true, locale)}</span>
              <Minus className="h-3 w-3" />
              <span>AI: {formatCurrency(totalAIBest, currency, true, locale)}</span>
            </div>
          </div>
        </div>

        {/* Confidence interval */}
        <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50/50 px-4 py-3">
          <p className="text-xs font-medium text-purple-700">AI Confidence Interval (90%)</p>
          <div className="mt-1 flex items-center gap-4 text-sm">
            <span className="tabular-nums text-muted-foreground">
              Low: {formatCurrency(totalAICommit * 0.85, currency, true, locale)}
            </span>
            <span className="font-bold tabular-nums text-purple-700">
              Expected: {formatCurrency(totalAICommit, currency, true, locale)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              High: {formatCurrency(totalAICommit * 1.12, currency, true, locale)}
            </span>
          </div>
        </div>

        {/* Recommended adjustments */}
        <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Recommended Adjustments
        </h4>
        <div className="space-y-3">
          {adjustments.map((adj, i) => (
            <div key={i} className="rounded-lg border px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{adj.deal}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {adj.rep}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {adj.repCategory}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {adj.aiRecommendation}
                    </span>
                    <span className={cn("font-medium tabular-nums", adj.impact < 0 ? "text-red-600" : "text-green-600")}>
                      ({adj.impact > 0 ? "+" : ""}{formatCurrency(adj.impact, currency, true, locale)})
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                    {adj.reason}
                  </p>
                </div>
                <div className="flex flex-col items-center">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold",
                    adj.confidence >= 80 ? "bg-green-100 text-green-700" :
                    adj.confidence >= 60 ? "bg-yellow-100 text-yellow-700" :
                    "bg-red-100 text-red-700",
                  )}>
                    {adj.confidence}
                  </div>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">confidence</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
    </svg>
  );
}

// ── Historical Tracking ─────────────────────────────────────────────────────

function HistoricalTracking({
  snapshots,
  historicalQuarters,
  changelog,
  currency,
  locale,
}: {
  snapshots: ForecastSnapshot[];
  historicalQuarters: HistoricalQuarter[];
  changelog: { date: string; change: string; user: string }[];
  currency: string;
  locale: string;
}) {
  const [histTab, setHistTab] = useState<"evolution" | "accuracy" | "changelog">("evolution");

  const maxVal = Math.max(
    ...snapshots.flatMap((s) => [s.commit, s.bestCase, s.pipeline, s.closedWon]),
  );

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Historical Tracking</h3>
        </div>
      </div>
      <div className="border-b px-4">
        <div className="flex gap-1">
          {([
            { key: "evolution" as const, label: "Forecast Evolution" },
            { key: "accuracy" as const, label: "Accuracy by Quarter" },
            { key: "changelog" as const, label: "Change Log" },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setHistTab(key)}
              className={cn(
                "border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                histTab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {histTab === "evolution" && (
          <div>
            <p className="mb-3 text-xs text-muted-foreground">
              Week-over-week forecast progression for current quarter
            </p>
            <div className="space-y-2">
              {snapshots.map((snap) => (
                <div key={snap.weekLabel} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{snap.weekLabel}</span>
                  <div className="flex-1">
                    <div className="flex h-5 gap-0.5 overflow-hidden rounded">
                      <div
                        className="bg-green-500 transition-all"
                        style={{ width: `${(snap.closedWon / maxVal) * 100}%` }}
                        title={`Closed: ${formatCurrency(snap.closedWon, currency, true, locale)}`}
                      />
                      <div
                        className="bg-blue-500 transition-all"
                        style={{ width: `${(snap.commit / maxVal) * 100}%` }}
                        title={`Commit: ${formatCurrency(snap.commit, currency, true, locale)}`}
                      />
                      <div
                        className="bg-yellow-400 transition-all"
                        style={{ width: `${(snap.bestCase / maxVal) * 100}%` }}
                        title={`Best Case: ${formatCurrency(snap.bestCase, currency, true, locale)}`}
                      />
                      <div
                        className="bg-gray-300 transition-all"
                        style={{ width: `${(snap.pipeline / maxVal) * 100}%` }}
                        title={`Pipeline: ${formatCurrency(snap.pipeline, currency, true, locale)}`}
                      />
                    </div>
                  </div>
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                    {formatCurrency(snap.commit + snap.closedWon, currency, true, locale)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-[10px]">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> Closed</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> Commit</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-400" /> Best Case</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-300" /> Pipeline</span>
            </div>
          </div>
        )}

        {histTab === "accuracy" && (
          <div>
            <p className="mb-3 text-xs text-muted-foreground">
              Forecast accuracy: committed vs actual closed per quarter
            </p>
            <div className="space-y-3">
              {historicalQuarters.map((q) => (
                <div key={q.quarter} className="rounded-lg bg-muted/30 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{q.quarter}</span>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-bold",
                      q.accuracy >= 90 ? "bg-green-100 text-green-700" :
                      q.accuracy >= 80 ? "bg-yellow-100 text-yellow-700" :
                      "bg-red-100 text-red-700",
                    )}>
                      {q.accuracy}% accurate
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Forecasted: <strong className="text-foreground">{formatCurrency(q.forecastedCommit, currency, true, locale)}</strong></span>
                    <span>Actual: <strong className="text-foreground">{formatCurrency(q.actualClose, currency, true, locale)}</strong></span>
                    <span className={q.actualClose < q.forecastedCommit ? "text-red-500" : "text-green-500"}>
                      {q.actualClose < q.forecastedCommit ? "-" : "+"}
                      {formatCurrency(Math.abs(q.actualClose - q.forecastedCommit), currency, true, locale)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        q.accuracy >= 90 ? "bg-green-500" : q.accuracy >= 80 ? "bg-yellow-500" : "bg-red-500",
                      )}
                      style={{ width: `${q.accuracy}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {histTab === "changelog" && (
          <div>
            <p className="mb-3 text-xs text-muted-foreground">
              Recent forecast changes and movements
            </p>
            <div className="space-y-2">
              {changelog.map((entry, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg border px-3 py-2">
                  <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground">{entry.change}</p>
                    <p className="text-[10px] text-muted-foreground">{entry.user}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Deal Inspection Panel ───────────────────────────────────────────────────

function DealInspectionPanel({
  deals,
  repId,
  repName,
  currency,
  locale,
  onClose,
}: {
  deals: ForecastDeal[];
  repId: string | null;
  repName: string | null;
  currency: string;
  locale: string;
  onClose: () => void;
}) {
  const [filterCategory, setFilterCategory] = useState<ForecastCategory | "all">("all");
  const [sortBy, setSortBy] = useState<"value" | "risk" | "activity">("value");

  const filteredDeals = useMemo(() => {
    let result = repId ? deals.filter((d) => d.ownerId === repId) : deals;
    if (filterCategory !== "all") {
      result = result.filter((d) => d.category === filterCategory);
    }
    return result.sort((a, b) => {
      if (sortBy === "value") return b.value - a.value;
      if (sortBy === "risk") return a.realityScore - b.realityScore;
      return b.daysSinceActivity - a.daysSinceActivity;
    });
  }, [deals, repId, filterCategory, sortBy]);

  const categories: (ForecastCategory | "all")[] = ["all", "closed", "commit", "best_case", "pipeline", "omitted"];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-2xl flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">
              Deal Inspection {repName && <span className="text-muted-foreground"> — {repName}</span>}
            </h3>
            <p className="text-xs text-muted-foreground">{filteredDeals.length} deals</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 border-b px-4 py-2">
          <div className="flex gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
                  filterCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {cat === "all" ? "All" : categoryLabel(cat)}
              </button>
            ))}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "value" | "risk" | "activity")}
            className="rounded border bg-background px-2 py-1 text-xs"
          >
            <option value="value">Sort by Value</option>
            <option value="risk">Sort by Risk</option>
            <option value="activity">Sort by Activity</option>
          </select>
        </div>

        {/* Deals list */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="space-y-2">
            {filteredDeals.map((deal) => (
              <div key={deal.id} className="rounded-lg border px-4 py-3 transition-colors hover:bg-muted/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", categoryColor(deal.category))} />
                      <span className="text-sm font-medium text-foreground truncate">{deal.name}</span>
                      {deal.movement !== "stable" && (
                        <span className={cn(
                          "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          deal.movement === "up" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700",
                        )}>
                          {deal.movement === "up" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                          {deal.previousCategory ? `from ${categoryLabel(deal.previousCategory)}` : "moved"}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{deal.company}</span>
                      <span>{deal.ownerName}</span>
                      <span>{deal.stage}</span>
                      <span>Close: {new Date(deal.closeDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums">{formatCurrency(deal.value, currency, true, locale)}</p>
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        deal.realityScore >= 70 ? "bg-green-100 text-green-700" :
                        deal.realityScore >= 40 ? "bg-yellow-100 text-yellow-700" :
                        "bg-red-100 text-red-700",
                      )}>
                        RS: {deal.realityScore}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Probability comparison */}
                <div className="mt-2 flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">
                    Rep: <strong className="text-foreground">{deal.repProbability}%</strong>
                  </span>
                  <span className="text-muted-foreground">
                    AI: <strong className="text-foreground">{deal.aiProbability}%</strong>
                  </span>
                  {Math.abs(deal.repProbability - deal.aiProbability) > 15 && (
                    <span className="text-yellow-600 font-medium">
                      {deal.repProbability - deal.aiProbability > 0 ? "+" : ""}
                      {deal.repProbability - deal.aiProbability}% variance
                    </span>
                  )}
                </div>

                {/* Risk flags */}
                {deal.riskFlags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {deal.riskFlags.map((flag, fi) => (
                      <span
                        key={fi}
                        className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-600 border border-red-200"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {flag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Next step */}
                {deal.nextStep && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Next:</span> {deal.nextStep}
                  </p>
                )}
              </div>
            ))}
            {filteredDeals.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No deals match the selected filters.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Submission Workflow ──────────────────────────────────────────────────────

function SubmissionWorkflow({
  manager,
  period,
  currency,
  locale,
  permissions,
}: {
  manager: RepForecast;
  period: TimePeriod;
  currency: string;
  locale: string;
  permissions: ReturnType<typeof usePermissions>;
}) {
  const [comments, setComments] = useState<ForecastComment[]>([
    { id: "c1", author: "Alex Rivera", text: "James, please update Nordic Retail category before I submit the rollup.", timestamp: "2026-03-07T10:30:00Z" },
    { id: "c2", author: "Sarah Chen", text: "GlobalTech legal review is progressing, confident on the Mar 25 close.", timestamp: "2026-03-07T14:45:00Z" },
    { id: "c3", author: "VP Sales", text: "Team looks solid this quarter. Alex, submit final rollup by EOD Friday.", timestamp: "2026-03-07T16:20:00Z" },
  ]);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const deadline = getQuarterDeadline(period);
  const daysLeft = daysUntil(deadline);

  const steps = [
    { label: "Rep Submits", status: manager.directReports?.filter((r) => r.status !== "draft").length === manager.directReports?.length ? "done" : "active" as const },
    { label: "Manager Reviews", status: manager.status === "submitted" || manager.status === "approved" || manager.status === "final" ? "done" : manager.directReports?.every((r) => r.status !== "draft") ? "active" : "pending" as const },
    { label: "Manager Submits Rollup", status: manager.status === "approved" || manager.status === "final" ? "done" : manager.status === "submitted" ? "active" : "pending" as const },
    { label: "VP Reviews", status: manager.status === "final" ? "done" : manager.status === "approved" ? "active" : "pending" as const },
  ];

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    setComments((prev) => [
      ...prev,
      {
        id: `c${Date.now()}`,
        author: "You",
        text: newComment.trim(),
        timestamp: new Date().toISOString(),
      },
    ]);
    setNewComment("");
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post("/api/v1/forecasts/submit", {
        period: getQuarterLabel(period),
        managerId: manager.repId,
      });
    } catch {
      // Demo - submission will "succeed" in the UI
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Submission Workflow</h3>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className={cn(
              "text-xs font-medium",
              daysLeft <= 3 ? "text-red-600" : daysLeft <= 7 ? "text-yellow-600" : "text-muted-foreground",
            )}>
              {daysLeft} days until deadline
            </span>
          </div>
        </div>
      </div>
      <div className="p-4">
        {/* Workflow steps */}
        <div className="mb-4 flex items-center gap-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                step.status === "done" ? "bg-green-100 text-green-700" :
                step.status === "active" ? "bg-blue-100 text-blue-700" :
                "bg-muted text-muted-foreground",
              )}>
                {step.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                 step.status === "active" ? <Clock className="h-3.5 w-3.5" /> :
                 <span className="h-3.5 w-3.5 rounded-full border border-current" />}
                {step.label}
              </div>
              {i < steps.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
          ))}
        </div>

        {/* Rep submission status */}
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Rep Status
          </h4>
          <div className="grid gap-2 md:grid-cols-3">
            {manager.directReports?.map((rep) => (
              <div key={rep.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <span className="text-sm font-medium">{rep.repName}</span>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                    statusBadgeClasses(rep.status),
                  )}>
                    {rep.status}
                  </span>
                  {rep.submittedAt && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(rep.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit button */}
        {(permissions.isManager || permissions.isAdmin) && (
          <div className="mb-4">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Forecast Rollup
            </button>
          </div>
        )}

        {/* Comments */}
        <div>
          <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Comments & Notes
          </h4>
          <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
            {comments.map((comment) => (
              <div key={comment.id} className="rounded-lg bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{comment.author}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(comment.timestamp).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{comment.text}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
              placeholder="Add a comment..."
              className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleAddComment}
              className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium hover:bg-muted/80"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Category Columns View ───────────────────────────────────────────────────

function CategoryColumns({
  deals,
  currency,
  locale,
}: {
  deals: ForecastDeal[];
  currency: string;
  locale: string;
}) {
  const categories: ForecastCategory[] = ["closed", "commit", "best_case", "pipeline", "omitted"];

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {categories.map((cat) => {
        const catDeals = deals.filter((d) => d.category === cat);
        const total = catDeals.reduce((s, d) => s + d.value, 0);
        return (
          <div key={cat} className="w-56 shrink-0">
            <div className={cn("rounded-t-lg border-t-4 bg-muted/50 px-3 py-2", {
              "border-green-500": cat === "closed",
              "border-blue-500": cat === "commit",
              "border-yellow-500": cat === "best_case",
              "border-gray-400": cat === "pipeline",
              "border-red-400": cat === "omitted",
            })}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{categoryLabel(cat)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">{catDeals.length}</span>
              </div>
              <p className="mt-0.5 text-xs font-bold tabular-nums">{formatCurrency(total, currency, true, locale)}</p>
            </div>
            <div className="space-y-1.5 pt-2">
              {catDeals.map((deal) => (
                <div key={deal.id} className="rounded-lg border bg-card px-3 py-2 shadow-sm">
                  <p className="text-xs font-medium text-foreground truncate">{deal.name}</p>
                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">{deal.ownerName}</span>
                    <span className="font-medium tabular-nums">{formatCurrency(deal.value, currency, true, locale)}</span>
                  </div>
                  {deal.riskFlags.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-red-500">
                      <AlertTriangle className="h-3 w-3" />
                      {deal.riskFlags.length} risk{deal.riskFlags.length > 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              ))}
              {catDeals.length === 0 && (
                <div className="rounded-lg border border-dashed px-3 py-4 text-center text-[10px] text-muted-foreground">
                  No deals
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ForecastingPage() {
  const { tenant } = useTenant();
  const currency = tenant.defaultCurrency;
  const locale = tenant.locale;
  const permissions = usePermissions();

  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>("current_quarter");
  const [activeTab, setActiveTab] = useState<"rollup" | "categories" | "ai" | "history" | "workflow">("rollup");
  const [inspectRep, setInspectRep] = useState<{ repId: string; repName: string } | null>(null);

  // Simulated API fetch
  const [deals, setDeals] = useState<ForecastDeal[]>([]);
  const [managerForecast, setManagerForecast] = useState<RepForecast | null>(null);

  const fetchForecastData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/forecasts?period=${getQuarterLabel(period)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data?.deals) setDeals(json.data.deals);
        if (json.data?.manager) setManagerForecast(json.data.manager);
      }
    } catch {
      // Fall back to demo data
    } finally {
      // Always fall back to demo data if nothing loaded
      setDeals((prev) => prev.length > 0 ? prev : DEMO_DEALS);
      setManagerForecast((prev) => prev ?? DEMO_MANAGER_FORECAST);
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchForecastData();
  }, [fetchForecastData]);

  const repForecasts = managerForecast?.directReports ?? DEMO_REP_FORECASTS;

  const tabs = [
    { key: "rollup" as const, label: "Forecast Rollup", icon: Users },
    { key: "categories" as const, label: "Categories", icon: Filter },
    { key: "ai" as const, label: "AI Overrides", icon: Brain },
    { key: "history" as const, label: "Historical", icon: BarChart3 },
    { key: "workflow" as const, label: "Submission", icon: Send },
  ];

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Forecasting</h1>
            <p className="text-xs text-muted-foreground">
              {getQuarterLabel(period)} — {daysUntil(getQuarterDeadline(period))} days remaining
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Time Period Selector */}
          <div className="flex rounded-lg border bg-background">
            {([
              { key: "current_quarter" as const, label: "This Qtr" },
              { key: "next_quarter" as const, label: "Next Qtr" },
              { key: "monthly" as const, label: "Monthly" },
              { key: "custom" as const, label: "Custom" },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-lg last:rounded-r-lg",
                  period === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchForecastData}
            disabled={loading}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <SummaryCards forecasts={repForecasts} currency={currency} locale={locale} />

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
              activeTab === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading forecast data...</span>
        </div>
      ) : (
        <>
          {activeTab === "rollup" && managerForecast && (
            <RollupTable
              manager={managerForecast}
              currency={currency}
              locale={locale}
              onInspect={(repId, repName) => setInspectRep({ repId, repName })}
            />
          )}

          {activeTab === "categories" && (
            <CategoryColumns deals={deals} currency={currency} locale={locale} />
          )}

          {activeTab === "ai" && (
            <AIOverridePanel forecasts={repForecasts} currency={currency} locale={locale} />
          )}

          {activeTab === "history" && (
            <HistoricalTracking
              snapshots={DEMO_SNAPSHOTS}
              historicalQuarters={DEMO_HISTORICAL}
              changelog={DEMO_CHANGELOG}
              currency={currency}
              locale={locale}
            />
          )}

          {activeTab === "workflow" && managerForecast && (
            <SubmissionWorkflow
              manager={managerForecast}
              period={period}
              currency={currency}
              locale={locale}
              permissions={permissions}
            />
          )}
        </>
      )}

      {/* Deal Inspection Panel */}
      {inspectRep && (
        <DealInspectionPanel
          deals={deals}
          repId={inspectRep.repId}
          repName={inspectRep.repName}
          currency={currency}
          locale={locale}
          onClose={() => setInspectRep(null)}
        />
      )}
    </div>
  );
}
