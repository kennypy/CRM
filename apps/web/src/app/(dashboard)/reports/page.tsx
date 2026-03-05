"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatCurrency, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { BarChart3, TrendingUp, TrendingDown, Users, Briefcase, Activity, Award, ArrowRight, Plus, X, Trash2, FileText, CheckCircle2, Sparkles, ChevronRight, ChevronLeft } from "lucide-react";

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

// ── Saved Reports ──────────────────────────────────────────────────────────────

const REPORT_TYPES = ["Pipeline", "Revenue", "Activity", "Contacts", "Win/Loss", "Sequence Performance"];
const GROUP_BY_OPTIONS = ["Stage", "Rep", "Period", "Source", "Company", "Product"];
const PERIODS = ["Last 7 days", "Last 30 days", "Last 90 days", "Last year", "Custom"];
const STAGES_LIST = ["Discovery", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];
const SOURCES_LIST = ["Inbound referral", "Outbound email", "Event / webinar", "Partner channel", "Auto-captured"];
const ACTIVITY_TYPES = ["Email", "Call", "Meeting", "Task"];
const LEAD_SOURCES = ["Website", "Referral", "LinkedIn", "Event", "Cold outreach", "Auto-captured"];

interface ReportFilters {
  // Common
  period: string;
  groupBy: string;
  rep: string;
  createdBy: string;
  createdFrom: string;
  createdTo: string;
  // Deal / Pipeline
  stage: string;
  valueMin: string;
  valueMax: string;
  closeFrom: string;
  closeTo: string;
  leadSource: string;
  // Revenue
  currency: string;
  includeForecast: boolean;
  // Activity
  activityType: string;
  deal: string;
  contact: string;
  direction: string;
  // Contacts / Leads
  assignedRep: string;
  leadStatus: string;
  source: string;
  hasOpenDeals: boolean;
  // Win/Loss
  stageLostAt: string;
  lossReason: string;
  // Sequence
  sequenceName: string;
  stepNumber: string;
  sequenceStatus: string;
}

const DEFAULT_FILTERS: ReportFilters = {
  period: PERIODS[1], groupBy: GROUP_BY_OPTIONS[0], rep: "", createdBy: "",
  createdFrom: "", createdTo: "", stage: "", valueMin: "", valueMax: "",
  closeFrom: "", closeTo: "", leadSource: "", currency: "", includeForecast: true,
  activityType: "", deal: "", contact: "", direction: "", assignedRep: "",
  leadStatus: "", source: "", hasOpenDeals: false, stageLostAt: "", lossReason: "",
  sequenceName: "", stepNumber: "", sequenceStatus: "",
};

interface SavedReport {
  id: string;
  name: string;
  type: string;
  filters: ReportFilters;
  nlQuery?: string;
  createdAt: string;
}

const LS_REPORTS = "nexcrm_saved_reports";
function loadReports(): SavedReport[] {
  try { return JSON.parse(localStorage.getItem(LS_REPORTS) ?? "[]"); } catch { return []; }
}
function persistReports(reports: SavedReport[]) {
  try { localStorage.setItem(LS_REPORTS, JSON.stringify(reports)); } catch {}
}

// ── NL Query Parser ────────────────────────────────────────────────────────────

function parseNLQuery(query: string, currentFilters: ReportFilters): Partial<ReportFilters> & { type?: string } {
  const q = query.toLowerCase();
  const patch: Partial<ReportFilters> & { type?: string } = {};

  // Period detection
  if (/last\s+7\s+days?|this\s+week/.test(q))        patch.period = "Last 7 days";
  else if (/last\s+30\s+days?|this\s+month/.test(q)) patch.period = "Last 30 days";
  else if (/last\s+90\s+days?|quarter/.test(q))      patch.period = "Last 90 days";
  else if (/last\s+year|annual|yearly/.test(q))       patch.period = "Last year";

  // Report type detection
  if (/revenue|closed\s+won|won|close[sd]/.test(q))     patch.type = "Revenue";
  else if (/pipeline|open\s+deal/.test(q))              patch.type = "Pipeline";
  else if (/activit|email|call|meeting/.test(q))         patch.type = "Activity";
  else if (/contact|lead/.test(q))                       patch.type = "Contacts";
  else if (/win.*loss|loss.*win|win\s+rate/.test(q))    patch.type = "Win/Loss";
  else if (/sequence|email\s+sequence/.test(q))          patch.type = "Sequence Performance";

  // Stage detection
  if (/closed\s+won/.test(q))       patch.stage = "Closed Won";
  else if (/closed\s+lost/.test(q)) patch.stage = "Closed Lost";
  else if (/negoti/.test(q))        patch.stage = "Negotiation";
  else if (/proposal/.test(q))      patch.stage = "Proposal";
  else if (/discovery/.test(q))     patch.stage = "Discovery";

  // Group by detection
  if (/by\s+rep|per\s+rep|rep\s+breakdown/.test(q))       patch.groupBy = "Rep";
  else if (/by\s+stage|per\s+stage/.test(q))              patch.groupBy = "Stage";
  else if (/by\s+source|per\s+source/.test(q))            patch.groupBy = "Source";
  else if (/by\s+company|per\s+company/.test(q))          patch.groupBy = "Company";
  else if (/by\s+period|over\s+time|trend/.test(q))       patch.groupBy = "Period";

  return patch;
}

// ── Type-Specific Filter Section ───────────────────────────────────────────────

function FilterSection({
  type, filters, onChange, inputCls,
}: {
  type: string;
  filters: ReportFilters;
  onChange: (patch: Partial<ReportFilters>) => void;
  inputCls: string;
}) {
  const F = filters;
  const set = (patch: Partial<ReportFilters>) => onChange(patch);

  const commonFields = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Period</label>
          <select value={F.period} onChange={(e) => set({ period: e.target.value })} className={inputCls}>
            {PERIODS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Group by</label>
          <select value={F.groupBy} onChange={(e) => set({ groupBy: e.target.value })} className={inputCls}>
            {GROUP_BY_OPTIONS.map((g) => <option key={g}>{g}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Created by</label>
          <input value={F.createdBy} onChange={(e) => set({ createdBy: e.target.value })} placeholder="e.g. sarah@acme.com" className={inputCls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Rep / Owner</label>
          <input value={F.rep} onChange={(e) => set({ rep: e.target.value })} placeholder="Any rep" className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Created from</label>
          <input type="date" value={F.createdFrom} onChange={(e) => set({ createdFrom: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Created to</label>
          <input type="date" value={F.createdTo} onChange={(e) => set({ createdTo: e.target.value })} className={inputCls} />
        </div>
      </div>
    </>
  );

  if (type === "Pipeline") {
    return (
      <div className="space-y-3">
        {commonFields}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Stage</label>
          <div className="flex flex-wrap gap-1.5">
            {["", ...STAGES_LIST].map((s) => (
              <button key={s} type="button" onClick={() => set({ stage: s })}
                className={cn("rounded-full px-2.5 py-1 text-xs border transition-colors",
                  F.stage === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                {s || "All stages"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Min value (£)</label>
            <input type="number" value={F.valueMin} onChange={(e) => set({ valueMin: e.target.value })} placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Max value (£)</label>
            <input type="number" value={F.valueMax} onChange={(e) => set({ valueMax: e.target.value })} placeholder="No limit" className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Close date from</label>
            <input type="date" value={F.closeFrom} onChange={(e) => set({ closeFrom: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Close date to</label>
            <input type="date" value={F.closeTo} onChange={(e) => set({ closeTo: e.target.value })} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Lead source</label>
          <select value={F.leadSource} onChange={(e) => set({ leadSource: e.target.value })} className={inputCls}>
            <option value="">All sources</option>
            {SOURCES_LIST.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
    );
  }

  if (type === "Revenue") {
    return (
      <div className="space-y-3">
        {commonFields}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Currency</label>
            <select value={F.currency} onChange={(e) => set({ currency: e.target.value })} className={inputCls}>
              <option value="">All currencies</option>
              {["GBP", "USD", "EUR", "CAD", "AUD"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={F.includeForecast} onChange={(e) => set({ includeForecast: e.target.checked })}
                className="h-4 w-4 rounded border-border" />
              Include forecast
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (type === "Activity") {
    return (
      <div className="space-y-3">
        {commonFields}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Activity type</label>
          <div className="flex flex-wrap gap-1.5">
            {["", ...ACTIVITY_TYPES].map((t) => (
              <button key={t} type="button" onClick={() => set({ activityType: t })}
                className={cn("rounded-full px-2.5 py-1 text-xs border transition-colors",
                  F.activityType === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                {t || "All types"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Deal</label>
            <input value={F.deal} onChange={(e) => set({ deal: e.target.value })} placeholder="Filter by deal name" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact</label>
            <input value={F.contact} onChange={(e) => set({ contact: e.target.value })} placeholder="Filter by contact" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Direction</label>
          <div className="flex gap-1.5">
            {["", "Inbound", "Outbound"].map((d) => (
              <button key={d} type="button" onClick={() => set({ direction: d })}
                className={cn("rounded-full px-2.5 py-1 text-xs border transition-colors",
                  F.direction === d ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                {d || "All"}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (type === "Contacts") {
    return (
      <div className="space-y-3">
        {commonFields}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Assigned rep</label>
            <input value={F.assignedRep} onChange={(e) => set({ assignedRep: e.target.value })} placeholder="Any rep" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Lead status</label>
            <div className="flex gap-1.5 mt-2">
              {["", "Lead", "Contact"].map((s) => (
                <button key={s} type="button" onClick={() => set({ leadStatus: s })}
                  className={cn("rounded-full px-2.5 py-1 text-xs border transition-colors",
                    F.leadStatus === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                  {s || "All"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Source</label>
          <select value={F.source} onChange={(e) => set({ source: e.target.value })} className={inputCls}>
            <option value="">All sources</option>
            {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={F.hasOpenDeals} onChange={(e) => set({ hasOpenDeals: e.target.checked })}
            className="h-4 w-4 rounded border-border" />
          Only contacts with open deals
        </label>
      </div>
    );
  }

  if (type === "Win/Loss") {
    return (
      <div className="space-y-3">
        {commonFields}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Stage lost at</label>
            <select value={F.stageLostAt} onChange={(e) => set({ stageLostAt: e.target.value })} className={inputCls}>
              <option value="">Any stage</option>
              {STAGES_LIST.filter((s) => s !== "Closed Won").map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Lead source</label>
            <select value={F.leadSource} onChange={(e) => set({ leadSource: e.target.value })} className={inputCls}>
              <option value="">All sources</option>
              {SOURCES_LIST.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Loss reason</label>
          <input value={F.lossReason} onChange={(e) => set({ lossReason: e.target.value })} placeholder="e.g. Price, Competitor, No budget" className={inputCls} />
        </div>
      </div>
    );
  }

  if (type === "Sequence Performance") {
    return (
      <div className="space-y-3">
        {commonFields}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Sequence name</label>
            <input value={F.sequenceName} onChange={(e) => set({ sequenceName: e.target.value })} placeholder="e.g. Nurture — Enterprise" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Step #</label>
            <input type="number" value={F.stepNumber} onChange={(e) => set({ stepNumber: e.target.value })} placeholder="Any step" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</label>
          <div className="flex gap-1.5">
            {["", "Active", "Completed", "Paused"].map((s) => (
              <button key={s} type="button" onClick={() => set({ sequenceStatus: s })}
                className={cn("rounded-full px-2.5 py-1 text-xs border transition-colors",
                  F.sequenceStatus === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                {s || "All"}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Fallback: common fields only
  return <div className="space-y-3">{commonFields}</div>;
}

// ── Create Report Modal (2-step) ───────────────────────────────────────────────

function CreateReportModal({ onClose, onSaved }: { onClose: () => void; onSaved: (r: SavedReport) => void }) {
  const [step,    setStep]    = useState<1 | 2>(1);
  const [rname,   setRname]   = useState("");
  const [type,    setType]    = useState(REPORT_TYPES[0]);
  const [nlQuery, setNlQuery] = useState("");
  const [parsed,  setParsed]  = useState(false);
  const [filters, setFilters] = useState<ReportFilters>({ ...DEFAULT_FILTERS });
  const [done,    setDone]    = useState(false);

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  const applyNL = () => {
    if (!nlQuery.trim()) return;
    const result = parseNLQuery(nlQuery, filters);
    const { type: parsedType, ...filterPatch } = result;
    if (parsedType) setType(parsedType);
    setFilters((prev) => ({ ...prev, ...filterPatch }));
    setParsed(true);
    // Auto-name from query if no name set
    if (!rname.trim()) {
      setRname(nlQuery.trim().charAt(0).toUpperCase() + nlQuery.trim().slice(1, 60));
    }
  };

  const handleSave = () => {
    if (!rname.trim()) return;
    const report: SavedReport = {
      id: Date.now().toString(),
      name: rname.trim(),
      type,
      filters,
      nlQuery: nlQuery.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    onSaved(report);
    setDone(true);
    setTimeout(onClose, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-card shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Create Report</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Step {step} of 2
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {/* Step indicators */}
        <div className="flex border-b shrink-0">
          {[1, 2].map((s) => (
            <button key={s} type="button"
              onClick={() => s < step ? setStep(s as 1 | 2) : undefined}
              className={cn(
                "flex-1 py-2.5 text-xs font-medium transition-colors",
                step === s ? "border-b-2 border-primary text-primary" :
                s < step ? "text-muted-foreground hover:text-foreground cursor-pointer" :
                "text-muted-foreground/40 cursor-default"
              )}>
              {s === 1 ? "1 · Type & Query" : "2 · Filters"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {step === 1 && (
            <>
              {/* Report name */}
              <div>
                <label className="mb-1.5 block text-sm font-medium">Report name *</label>
                <input value={rname} onChange={(e) => setRname(e.target.value)}
                  placeholder="e.g. Q1 Closed Won by Rep" className={inputCls} />
              </div>

              {/* Report type */}
              <div>
                <label className="mb-1.5 block text-sm font-medium">Report type</label>
                <div className="flex flex-wrap gap-2">
                  {REPORT_TYPES.map((t) => (
                    <button key={t} type="button" onClick={() => { setType(t); setParsed(false); }}
                      className={cn("rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                        type === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted")}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* NL Query */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Ask in plain English
                  <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">optional</span>
                </label>
                <div className="flex gap-2">
                  <input
                    value={nlQuery}
                    onChange={(e) => { setNlQuery(e.target.value); setParsed(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") applyNL(); }}
                    placeholder='e.g. "deals closed in the last 30 days by rep"'
                    className={cn(inputCls, "flex-1")}
                  />
                  <button type="button" onClick={applyNL}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 shrink-0">
                    Parse
                  </button>
                </div>
                {parsed && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Filters pre-filled from your query — review and adjust in Step 2
                  </div>
                )}
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Examples: "deals closed last 30 days", "contact activity by rep this quarter", "win rate by lead source"
                </p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-muted-foreground">
                Configure filters for your <strong>{type}</strong> report. All fields are optional.
              </p>
              <FilterSection
                type={type}
                filters={filters}
                onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
                inputCls={inputCls}
              />
            </>
          )}

          {done && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Report saved!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t px-6 py-4 shrink-0">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
            Cancel
          </button>
          {step === 1 ? (
            <button type="button" onClick={() => setStep(2)} disabled={!rname.trim()}
              className={cn("ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                !rname.trim() ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
              Next: Filters <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setStep(1)}
                className="flex items-center gap-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button type="button" onClick={handleSave}
                className="ml-auto rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
                Save Report
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SavedReportsList({ reports, onDelete, onRun }: { reports: SavedReport[]; onDelete: (id: string) => void; onRun: (r: SavedReport) => void }) {
  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-muted-foreground">No saved reports yet — click "Create Report" to build one.</p>
      </div>
    );
  }
  const TYPE_COLORS: Record<string, string> = {
    Pipeline: "bg-blue-100 text-blue-700", Revenue: "bg-green-100 text-green-700",
    Activity: "bg-purple-100 text-purple-700", Contacts: "bg-orange-100 text-orange-700",
    "Win/Loss": "bg-red-100 text-red-700", "Sequence Performance": "bg-yellow-100 text-yellow-700",
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((r) => (
        <div key={r.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium mb-2", TYPE_COLORS[r.type] ?? "bg-muted text-muted-foreground")}>
                {r.type}
              </span>
              <h3 className="font-semibold text-sm">{r.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">{r.filters?.period ?? "—"} · Grouped by {r.filters?.groupBy ?? "—"}</p>
              {r.nlQuery && <p className="text-xs text-muted-foreground mt-0.5 italic truncate">"{r.nlQuery}"</p>}
              <p className="text-xs text-muted-foreground mt-0.5">
                Created {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </p>
            </div>
            <button onClick={() => onDelete(r.id)} className="text-muted-foreground hover:text-red-600 transition-colors shrink-0">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <button onClick={() => onRun(r)} className="mt-3 w-full rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors">
            Run Report
          </button>
        </div>
      ))}
    </div>
  );
}

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

type PageView = "analytics" | "saved";

export default function ReportsPage() {
  const { tenant } = useTenant();
  const currency   = tenant.defaultCurrency;
  const locale     = tenant.locale;

  const [period,       setPeriod]       = useState<Period>("30d");
  const [pageView,     setPageView]     = useState<PageView>("analytics");
  const [showCreate,   setShowCreate]   = useState(false);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [activeReport, setActiveReport] = useState<SavedReport | null>(null);

  const PERIOD_MAP: Record<string, Period> = {
    "Last 7 days":  "7d",
    "Last 30 days": "30d",
    "Last 90 days": "90d",
    "Last year":    "1y",
  };

  // Which chart sections to show when a saved report is active
  const REPORT_TYPE_SECTIONS: Record<string, string[]> = {
    Pipeline:               ["pipeline"],
    Revenue:                ["revenue"],
    Activity:               ["activity"],
    "Win/Loss":             ["pipeline", "winloss"],
    Contacts:               ["reps", "activity"],
    "Sequence Performance": ["activity"],
  };
  const showSection = (key: string) =>
    !activeReport || (REPORT_TYPE_SECTIONS[activeReport.type] ?? Object.keys(REPORT_TYPE_SECTIONS).flatMap((k) => REPORT_TYPE_SECTIONS[k])).includes(key);

  useEffect(() => { setSavedReports(loadReports()); }, []);

  const handleSaved = (r: SavedReport) => {
    setSavedReports((prev) => {
      const next = [r, ...prev];
      persistReports(next);
      return next;
    });
  };
  const handleDelete = (id: string) => {
    setSavedReports((prev) => {
      const next = prev.filter((r) => r.id !== id);
      persistReports(next);
      return next;
    });
    if (activeReport?.id === id) setActiveReport(null);
  };

  const handleRun = (r: SavedReport) => {
    const mapped = r.filters?.period ? PERIOD_MAP[r.filters.period] : undefined;
    if (mapped) setPeriod(mapped);
    setActiveReport(r);
    setPageView("analytics");
  };

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
      {showCreate && <CreateReportModal onClose={() => setShowCreate(false)} onSaved={handleSaved} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Reports</h1>
          {savedReports.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {savedReports.length} saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button onClick={() => setPageView("analytics")}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors",
                pageView === "analytics" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Analytics
            </button>
            <button onClick={() => setPageView("saved")}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors",
                pageView === "saved" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Saved Reports
            </button>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Create Report
          </button>
        </div>
      </div>

      {/* Period picker (only on analytics view) */}
      {pageView === "analytics" && (
        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
          {(["7d", "30d", "90d", "1y"] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors",
                period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {p}
            </button>
          ))}
        </div>
      )}

      {pageView === "saved" && <SavedReportsList reports={savedReports} onDelete={handleDelete} onRun={handleRun} />}
      {pageView === "analytics" && <>

      {activeReport && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <span className="text-muted-foreground">Viewing report:</span>
            <span className="font-semibold text-foreground">{activeReport.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{activeReport.type}</span>
            <span className="text-muted-foreground">·</span>
            <button onClick={() => setActiveReport(null)} className="text-xs text-primary hover:underline">
              Show all charts
            </button>
          </div>
          <button onClick={() => setActiveReport(null)} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Open Pipeline"   value={formatCurrency(totalOpen, currency, true, locale)} delta={deltas.pipeline} deltaLabel={periodLabel} icon={Briefcase}  color="bg-blue-100 text-blue-600" />
        <KpiCard label="Revenue Closed"  value={formatCurrency(totalWon,  currency, true, locale)} delta={deltas.revenue}  deltaLabel={periodLabel} icon={TrendingUp}  color="bg-green-100 text-green-600" />
        <KpiCard label="Win Rate"        value={`${winRate}%`}                                     delta={deltas.winRate}  deltaLabel={periodLabel} icon={Award}       color="bg-purple-100 text-purple-600" />
        <KpiCard label="Avg Sales Cycle" value={`${pipeline.find(s => s.stage === "Closed Won")?.avg_days ?? 37} days`}   delta={deltas.cycle}    deltaLabel={periodLabel} icon={Activity}    color="bg-orange-100 text-orange-600" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pipeline by Stage — each row drills into /pipeline */}
        {showSection("pipeline") && <div className="rounded-xl border bg-card p-5">
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
        </div>}

        {/* Monthly / Period Revenue */}
        {showSection("revenue") && <div className="rounded-xl border bg-card p-5">
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
        </div>}

        {/* Rep Leaderboard — each row links to /contacts */}
        {showSection("reps") && <div className="rounded-xl border bg-card p-5">
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
        </div>}

        {/* Win Rate by Lead Source */}
        {showSection("winloss") && <div className="rounded-xl border bg-card p-5">
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
        </div>}
      </div>

      {/* Activity Volume */}
      {showSection("activity") && <div className="rounded-xl border bg-card p-5">
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
      </div>}
      </>}
    </div>
  );
}
