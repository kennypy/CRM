"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BarChart3, Plus, Play, Trash2, Download, Bell,
  ChevronDown, ChevronUp, Loader2, RefreshCw, Camera, X,
  Check, Search, Clock, Rows3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ActionBar } from "@/components/action-bar/action-bar";

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceId = "activities" | "deals" | "companies" | "contacts" | "quotes" | "users";

const SOURCE_LABELS: Record<SourceId, string> = {
  activities: "Activities",
  deals:      "Deals",
  companies:  "Companies",
  contacts:   "Contacts",
  quotes:     "Quotes",
  users:      "Users",
};

const SOURCE_FIELDS: Record<SourceId, string[]> = {
  activities: ["id","type","direction","subject","summary","sentiment","duration_seconds","occurred_at","deal_id","company_id","source","created_at"],
  deals:      ["id","name","stage","value","currency","close_date","company_id","owner_id","reality_score","created_at","updated_at"],
  companies:  ["id","name","domain","city","country","created_at"],
  contacts:   ["id","firstName","lastName","fullName","email","title","seniority","isLead","created_at"],
  quotes:     ["id","quote_number","title","status","company_name","contact_name","total","subtotal","currency","valid_until","created_at","updated_at"],
  users:      ["id","first_name","last_name","email","role","can_quote"],
};

const SUGGESTED_JOINS = [
  { from: "activities" as SourceId, to: "deals"     as SourceId, label: "Activity → Deal",    on: { left: "deal_id",    right: "id" } },
  { from: "activities" as SourceId, to: "companies" as SourceId, label: "Activity → Company", on: { left: "company_id", right: "id" } },
  { from: "deals"      as SourceId, to: "companies" as SourceId, label: "Deal → Company",     on: { left: "company_id", right: "id" } },
  { from: "quotes"     as SourceId, to: "contacts"  as SourceId, label: "Quote → Contact",    on: { left: "contact_id", right: "id" } },
  { from: "quotes"     as SourceId, to: "deals"     as SourceId, label: "Quote → Deal",       on: { left: "deal_id",    right: "id" } },
];

const PERIOD_OPTIONS = [
  { value: "",              label: "All time" },
  { value: "last_7_days",   label: "Last 7 days" },
  { value: "last_30_days",  label: "Last 30 days" },
  { value: "last_90_days",  label: "Last 90 days" },
  { value: "last_year",     label: "Last year" },
];

const FILTER_OPS = [
  { value: "eq",           label: "=" },
  { value: "neq",          label: "≠" },
  { value: "contains",     label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "gt",           label: ">" },
  { value: "gte",          label: "≥" },
  { value: "lt",           label: "<" },
  { value: "lte",          label: "≤" },
  { value: "is_null",      label: "is empty" },
  { value: "not_null",     label: "is not empty" },
];

interface FilterRow {
  id:     string;
  source: SourceId;
  field:  string;
  op:     string;
  value:  string;
}

interface SavedReport {
  id:          string;
  name:        string;
  description: string | null;
  spec:        Record<string, unknown>;
  created_at:  string;
  updated_at:  string;
  lastSnapshot?: { taken_at: string; row_count: number } | null;
}

interface QueryResult {
  rows:     Record<string, unknown>[];
  columns:  string[];
  rowCount: number;
}

interface SubscribeModalState {
  reportId:   string;
  reportName: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 7 ? `${days}d ago` : fmtDate(iso);
}

function downloadCSV(columns: string[], rows: Record<string, unknown>[], filename = "report.csv") {
  const header = columns.join(",");
  const body   = rows.map((r) =>
    columns.map((c) => {
      const v = r[c];
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Subscribe Modal ───────────────────────────────────────────────────────────

function SubscribeModal({ state, onClose }: { state: SubscribeModalState; onClose: () => void }) {
  const [schedule, setSchedule] = useState("0 8 * * 1");
  const [channels, setChannels] = useState<string[]>(["email"]);
  const [slackUrl, setSlackUrl] = useState("");
  const [teamsUrl, setTeamsUrl] = useState("");
  const [webhook,  setWebhook]  = useState("");
  const [thField,  setThField]  = useState("");
  const [thOp,     setThOp]     = useState("lt");
  const [thValue,  setThValue]  = useState("");
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState("");

  const PRESETS = [
    { label: "Daily 9am",   value: "0 9 * * *" },
    { label: "Mon 8am",     value: "0 8 * * 1" },
    { label: "Monthly 1st", value: "0 9 1 * *" },
  ];

  const isPreset = PRESETS.some((p) => p.value === schedule);

  async function handleSave() {
    setSaving(true); setError("");
    const ch = [...channels];
    if (channels.includes("slack")   && slackUrl)  ch.push(`slack:${slackUrl}`);
    if (channels.includes("teams")   && teamsUrl)  ch.push(`teams:${teamsUrl}`);
    if (channels.includes("webhook") && webhook)   ch.push(`webhook:${webhook}`);
    const body: Record<string, unknown> = { schedule, channels: ch };
    if (thField && thValue) body.threshold = { field: thField, op: thOp, value: thValue };
    try {
      const res = await api.post(`/api/v1/reports/${state.reportId}/subscriptions`, body);
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(onClose, 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to subscribe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0f0f1a] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Subscribe — {state.reportName}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <label className="mb-1 block text-xs text-white/50">Schedule</label>
        <div className="mb-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.value} onClick={() => setSchedule(p.value)}
              className={cn("rounded px-2.5 py-1 text-xs", schedule === p.value ? "bg-violet-600 text-white" : "bg-white/5 text-white/60 hover:bg-white/10")}>
              {p.label}
            </button>
          ))}
          <button onClick={() => setSchedule("")}
            className={cn("rounded px-2.5 py-1 text-xs", !isPreset && schedule === "" ? "bg-violet-600 text-white" : "bg-white/5 text-white/60 hover:bg-white/10")}>
            Custom
          </button>
        </div>
        {!isPreset && (
          <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="cron e.g. 0 9 * * 1"
            className="mb-3 w-full rounded bg-white/5 px-3 py-1.5 text-xs text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />
        )}

        <label className="mb-1 block text-xs text-white/50">Channels</label>
        <div className="mb-3 flex gap-2">
          {["email","slack","teams","webhook"].map((ch) => (
            <button key={ch} onClick={() => setChannels((p) => p.includes(ch) ? p.filter((c) => c !== ch) : [...p, ch])}
              className={cn("rounded px-2.5 py-1 text-xs capitalize", channels.includes(ch) ? "bg-violet-600 text-white" : "bg-white/5 text-white/60 hover:bg-white/10")}>
              {ch}
            </button>
          ))}
        </div>
        {channels.includes("slack")   && <input value={slackUrl}  onChange={(e) => setSlackUrl(e.target.value)}  placeholder="Slack webhook URL"  className="mb-2 w-full rounded bg-white/5 px-3 py-1.5 text-xs text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />}
        {channels.includes("teams")   && <input value={teamsUrl}  onChange={(e) => setTeamsUrl(e.target.value)}  placeholder="Teams webhook URL"  className="mb-2 w-full rounded bg-white/5 px-3 py-1.5 text-xs text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />}
        {channels.includes("webhook") && <input value={webhook}   onChange={(e) => setWebhook(e.target.value)}   placeholder="Webhook URL"        className="mb-3 w-full rounded bg-white/5 px-3 py-1.5 text-xs text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />}

        <label className="mb-1 block text-xs text-white/50">Only deliver if (optional)</label>
        <div className="mb-4 flex gap-2">
          <input value={thField} onChange={(e) => setThField(e.target.value)} placeholder="field"
            className="flex-1 rounded bg-white/5 px-2 py-1.5 text-xs text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />
          <select value={thOp} onChange={(e) => setThOp(e.target.value)}
            className="rounded bg-white/5 px-2 py-1.5 text-xs text-white border border-white/10 focus:outline-none focus:border-violet-500">
            {FILTER_OPS.slice(0,8).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input value={thValue} onChange={(e) => setThValue(e.target.value)} placeholder="value"
            className="w-20 rounded bg-white/5 px-2 py-1.5 text-xs text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />
        </div>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <button onClick={handleSave} disabled={saving || saved}
          className="w-full rounded-lg bg-violet-600 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50 flex items-center justify-center gap-2">
          {saved ? <><Check className="h-3.5 w-3.5" />Subscribed!</> : saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : "Subscribe"}
        </button>
      </div>
    </div>
  );
}

// ── Save Report Modal ─────────────────────────────────────────────────────────

function SaveReportModal({ spec, onClose, onSaved }: {
  spec: Record<string, unknown>;
  onClose: () => void;
  onSaved: (r: SavedReport) => void;
}) {
  const [name,  setName]  = useState("");
  const [desc,  setDesc]  = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  async function handleSave() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    try {
      const res = await api.post("/api/v1/reports", { name: name.trim(), description: desc.trim() || null, spec });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      onSaved(json.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#0f0f1a] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Save report</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name"
          className="mb-2 w-full rounded bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" rows={2}
          className="mb-4 w-full rounded bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500 resize-none" />
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <button onClick={handleSave} disabled={saving}
          className="w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : "Save Report"}
        </button>
      </div>
    </div>
  );
}

// ── Results Table ─────────────────────────────────────────────────────────────

function ResultsTable({ result, onDownload }: { result: QueryResult; onDownload: () => void }) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = sortCol
    ? [...result.rows].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
      })
    : result.rows;

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc((p) => !p);
    else { setSortCol(col); setSortAsc(true); }
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-white/40">{result.rowCount.toLocaleString()} rows</span>
        <button onClick={onDownload} className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-white/60 hover:bg-white/5 hover:text-white">
          <Download className="h-3.5 w-3.5" />Download CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {result.columns.map((col) => (
                <th key={col} onClick={() => toggleSort(col)}
                  className="cursor-pointer select-none px-3 py-2 text-left text-white/50 hover:text-white whitespace-nowrap">
                  <span className="flex items-center gap-1">
                    {col}
                    {sortCol === col ? (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 500).map((row, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                {result.columns.map((col) => (
                  <td key={col} className="max-w-[240px] truncate px-3 py-1.5 text-white/80">
                    {row[col] == null ? <span className="text-white/20">—</span> : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 500 && (
          <p className="px-3 py-2 text-xs text-white/30">Showing first 500 rows — download CSV for full data.</p>
        )}
      </div>
    </div>
  );
}

// ── Quick Run Builder ─────────────────────────────────────────────────────────

function QuickRunBuilder({ onSaved }: { onSaved: (r: SavedReport) => void }) {
  const [sources,        setSources]        = useState<SourceId[]>(["activities"]);
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
  const [filters,        setFilters]        = useState<FilterRow[]>([]);
  const [filterLogic,    setFilterLogic]    = useState<"AND" | "OR">("AND");
  const [period,         setPeriod]         = useState("");
  const [periodField,    setPeriodField]    = useState("occurred_at");
  const [limit,          setLimit]          = useState(1000);
  const [running,        setRunning]        = useState(false);
  const [result,         setResult]         = useState<QueryResult | null>(null);
  const [error,          setError]          = useState("");
  const [showSave,       setShowSave]       = useState(false);

  const activeJoins = SUGGESTED_JOINS.filter((j) => sources.includes(j.from) && sources.includes(j.to));

  function toggleSource(s: SourceId) {
    setSources((prev) => prev.includes(s) ? (prev.length > 1 ? prev.filter((x) => x !== s) : prev) : [...prev, s]);
  }

  function addFilter() {
    setFilters((prev) => [...prev, {
      id: crypto.randomUUID(), source: sources[0], field: SOURCE_FIELDS[sources[0]][0], op: "eq", value: "",
    }]);
  }

  function buildSpec(): Record<string, unknown> {
    const allFields = Object.entries(selectedFields)
      .filter(([, v]) => v)
      .map(([key]) => {
        const [src, ...rest] = key.split(".");
        return { source: src, field: rest.join("."), alias: `${src}.${rest.join(".")}` };
      });

    const fields = allFields.length > 0
      ? allFields
      : sources.flatMap((s) => SOURCE_FIELDS[s].slice(0, 5).map((f) => ({ source: s, field: f, alias: `${s}.${f}` })));

    const conditions = filters
      .filter((f) => f.value || ["is_null","not_null"].includes(f.op))
      .map((f) => ({ source: f.source, field: f.field, op: f.op, value: f.value || undefined }));

    return {
      sources,
      joins:   activeJoins.map((j) => ({ type: "LEFT", from: j.from, to: j.to, on: j.on })),
      fields,
      filters: { logic: filterLogic, conditions },
      ...(period ? { period: { field: periodField, range: period } } : {}),
      limit,
    };
  }

  async function handleRun() {
    setRunning(true); setError(""); setResult(null);
    try {
      const res = await api.post("/api/v1/reports/run", { spec: buildSpec() });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: { message?: string } }).error?.message ?? "Run failed");
      }
      setResult((await res.json()).data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to run report");
    } finally {
      setRunning(false);
    }
  }

  const dateFields = sources.flatMap((s) =>
    SOURCE_FIELDS[s]
      .filter((f) => f.includes("_at") || f.includes("date"))
      .map((f) => ({ key: `${s}.${f}`, label: `${SOURCE_LABELS[s]}.${f}` }))
  );

  return (
    <div className="space-y-5">
      {/* Sources */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">Sources</h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SOURCE_LABELS) as SourceId[]).map((s) => (
            <button key={s} onClick={() => toggleSource(s)}
              className={cn("rounded-full px-3 py-1 text-xs font-medium transition-colors",
                sources.includes(s) ? "bg-violet-600 text-white" : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white")}>
              {SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
        {activeJoins.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeJoins.map((j) => (
              <span key={j.label} className="rounded bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300">⟳ {j.label}</span>
            ))}
          </div>
        )}
      </div>

      {/* Fields */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
          Fields <span className="normal-case font-normal text-white/30">(leave unchecked to auto-select top 5 per source)</span>
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
          {sources.flatMap((s) =>
            SOURCE_FIELDS[s].map((f) => {
              const key = `${s}.${f}`;
              return (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-xs text-white/60 hover:text-white">
                  <input type="checkbox" checked={!!selectedFields[key]}
                    onChange={() => setSelectedFields((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className="accent-violet-500" />
                  <span className="text-white/30">{SOURCE_LABELS[s]}.</span>{f}
                </label>
              );
            })
          )}
        </div>
      </div>

      {/* Filters */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50">Filters</h3>
          <div className="flex rounded-full bg-white/5 p-0.5 text-xs">
            {(["AND","OR"] as const).map((l) => (
              <button key={l} onClick={() => setFilterLogic(l)}
                className={cn("rounded-full px-2.5 py-0.5 font-medium", filterLogic === l ? "bg-violet-600 text-white" : "text-white/40 hover:text-white")}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={addFilter} className="text-xs text-violet-400 hover:text-violet-300">+ Add filter</button>
        </div>
        <div className="space-y-2">
          {filters.map((f) => (
            <div key={f.id} className="flex items-center gap-2 flex-wrap">
              <select value={f.source}
                onChange={(e) => setFilters((p) => p.map((r) => r.id === f.id ? { ...r, source: e.target.value as SourceId, field: SOURCE_FIELDS[e.target.value as SourceId][0] } : r))}
                className="rounded bg-white/5 px-2 py-1 text-xs text-white border border-white/10 focus:outline-none focus:border-violet-500">
                {sources.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
              </select>
              <select value={f.field}
                onChange={(e) => setFilters((p) => p.map((r) => r.id === f.id ? { ...r, field: e.target.value } : r))}
                className="rounded bg-white/5 px-2 py-1 text-xs text-white border border-white/10 focus:outline-none focus:border-violet-500">
                {SOURCE_FIELDS[f.source].map((fld) => <option key={fld} value={fld}>{fld}</option>)}
              </select>
              <select value={f.op}
                onChange={(e) => setFilters((p) => p.map((r) => r.id === f.id ? { ...r, op: e.target.value } : r))}
                className="rounded bg-white/5 px-2 py-1 text-xs text-white border border-white/10 focus:outline-none focus:border-violet-500">
                {FILTER_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {!["is_null","not_null"].includes(f.op) && (
                <input value={f.value} onChange={(e) => setFilters((p) => p.map((r) => r.id === f.id ? { ...r, value: e.target.value } : r))}
                  placeholder="value"
                  className="w-32 rounded bg-white/5 px-2 py-1 text-xs text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />
              )}
              <button onClick={() => setFilters((p) => p.filter((r) => r.id !== f.id))} className="text-white/30 hover:text-red-400">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Period + Limit */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs text-white/50">Period</label>
          <div className="flex items-center gap-2">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}
              className="rounded bg-white/5 px-2 py-1.5 text-xs text-white border border-white/10 focus:outline-none focus:border-violet-500">
              {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {period && dateFields.length > 0 && (
              <select value={periodField} onChange={(e) => setPeriodField(e.target.value)}
                className="rounded bg-white/5 px-2 py-1.5 text-xs text-white border border-white/10 focus:outline-none focus:border-violet-500">
                {dateFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            )}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/50">Row limit</label>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded bg-white/5 px-2 py-1.5 text-xs text-white border border-white/10 focus:outline-none focus:border-violet-500">
            {[100,500,1000,2000,5000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
          </select>
        </div>
      </div>

      {/* Run */}
      <div className="flex items-center gap-3">
        <button onClick={handleRun} disabled={running}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Query
        </button>
        {result && (
          <button onClick={() => setShowSave(true)}
            className="flex items-center gap-2 rounded-lg border border-violet-500/30 px-4 py-2 text-sm font-medium text-violet-400 hover:bg-violet-500/10">
            Save as Report
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <ResultsTable result={result} onDownload={() => downloadCSV(result.columns, result.rows)} />}

      {showSave && result && (
        <SaveReportModal spec={buildSpec()} onClose={() => setShowSave(false)} onSaved={(r) => { setShowSave(false); onSaved(r); }} />
      )}
    </div>
  );
}

// ── Report Card ───────────────────────────────────────────────────────────────

function ReportCard({ report, onDelete, onSubscribe, onSnapshot }: {
  report:      SavedReport;
  onDelete:    (id: string) => void;
  onSubscribe: (r: SavedReport) => void;
  onSnapshot:  (id: string) => void;
}) {
  const [running,  setRunning]  = useState(false);
  const [result,   setResult]   = useState<QueryResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [snapping, setSnapping] = useState(false);

  async function handleRun() {
    setRunning(true);
    try {
      const res = await api.post("/api/v1/reports/run", { spec: report.spec });
      if (!res.ok) throw new Error();
      setResult((await res.json()).data);
      setExpanded(true);
    } catch { /* silently fail */ } finally { setRunning(false); }
  }

  async function handleSnapshot() {
    setSnapping(true);
    try { await api.post(`/api/v1/reports/${report.id}/snapshot`, {}); onSnapshot(report.id); }
    finally { setSnapping(false); }
  }

  const sources = ((report.spec as { sources?: string[] })?.sources ?? []) as SourceId[];

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-white">{report.name}</h3>
          {report.description && <p className="mt-0.5 truncate text-xs text-white/40">{report.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {sources.map((s) => (
              <span key={s} className="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs text-violet-300">
                {SOURCE_LABELS[s] ?? s}
              </span>
            ))}
            {report.lastSnapshot && (
              <span className="text-xs text-white/30">
                <Clock className="mr-0.5 inline h-3 w-3" />
                {fmtRelative(report.lastSnapshot.taken_at)} · {report.lastSnapshot.row_count.toLocaleString()} rows
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={handleRun} disabled={running} title="Run"
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white disabled:opacity-40">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button onClick={handleSnapshot} disabled={snapping} title="Take snapshot"
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white disabled:opacity-40">
            {snapping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => onSubscribe(report)} title="Subscribe"
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white">
            <Bell className="h-3.5 w-3.5" />
          </button>
          <Link href={`/reports/builder?id=${report.id}`} title="Edit in builder"
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white text-sm">
            ✎
          </Link>
          <button onClick={() => onDelete(report.id)} title="Delete"
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-white/30 hover:text-red-400">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && result && (
        <div>
          <ResultsTable result={result} onDownload={() => downloadCSV(result.columns, result.rows, `${report.name}.csv`)} />
          <button onClick={() => setExpanded(false)} className="mt-2 text-xs text-white/30 hover:text-white/60">Collapse ↑</button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [tab,            setTab]            = useState<"saved" | "quick">("saved");
  const [reports,        setReports]        = useState<SavedReport[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState("");
  const [subscribeModal, setSubscribeModal] = useState<SubscribeModalState | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/v1/reports");
      if (!res.ok) throw new Error();
      setReports((await res.json()).data ?? []);
    } catch { /* leave empty */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this report?")) return;
    await api.delete(`/api/v1/reports/${id}`);
    setReports((prev) => prev.filter((r) => r.id !== id));
  }

  const filtered = reports.filter((r) =>
    !search ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <ActionBar />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Reports</h1>
          <p className="mt-0.5 text-xs text-white/40">
            Cross-object analytics across Activities, Deals, Companies, Contacts &amp; Quotes
          </p>
        </div>
        <Link href="/reports/builder"
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500">
          <Plus className="h-3.5 w-3.5" />New Report
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-white/5 p-1 w-fit">
        {([
          { key: "saved" as const, label: "Saved Reports", Icon: Rows3 },
          { key: "quick" as const, label: "Quick Run",      Icon: Play  },
        ]).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              tab === key ? "bg-violet-600 text-white" : "text-white/50 hover:text-white")}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Saved Reports */}
      {tab === "saved" && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reports…"
                className="w-full rounded-lg bg-white/5 pl-9 pr-4 py-2 text-sm text-white placeholder-white/30 border border-white/10 focus:outline-none focus:border-violet-500" />
            </div>
            <button onClick={fetchReports}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/50 hover:text-white hover:bg-white/5">
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-white/30">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-white/10 py-16 text-center">
              <BarChart3 className="h-10 w-10 text-white/20" />
              <div>
                <p className="text-sm text-white/40">No saved reports yet</p>
                <p className="mt-1 text-xs text-white/20">Use Quick Run to explore, then save — or build one from scratch.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setTab("quick")}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500">
                  Quick Run
                </button>
                <Link href="/reports/builder"
                  className="rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-white/60 hover:bg-white/5 hover:text-white">
                  Report Builder
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((r) => (
                <ReportCard key={r.id} report={r}
                  onDelete={handleDelete}
                  onSubscribe={(rep) => setSubscribeModal({ reportId: rep.id, reportName: rep.name })}
                  onSnapshot={() => fetchReports()}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick Run */}
      {tab === "quick" && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <QuickRunBuilder onSaved={(r) => { setReports((prev) => [r, ...prev]); setTab("saved"); }} />
        </div>
      )}

      {subscribeModal && (
        <SubscribeModal state={subscribeModal} onClose={() => setSubscribeModal(null)} />
      )}
    </div>
  );
}
