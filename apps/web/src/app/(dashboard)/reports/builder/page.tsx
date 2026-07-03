"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Check, Loader2, Play, X, ChevronDown, ChevronUp, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceId = "activities" | "deals" | "companies" | "contacts" | "quotes" | "users";
type JoinType  = "LEFT" | "INNER";

const SOURCE_LABELS: Record<SourceId, string> = {
  activities: "Activities",
  deals:      "Opportunities",
  companies:  "Companies",
  contacts:   "Contacts",
  quotes:     "Quotes",
  users:      "Users",
};

const SOURCE_FIELDS: Record<SourceId, { key: string; label: string }[]> = {
  activities: [
    { key: "id",               label: "Activity ID" },
    { key: "type",             label: "Type" },
    { key: "direction",        label: "Direction" },
    { key: "subject",          label: "Subject" },
    { key: "summary",          label: "Summary" },
    { key: "sentiment",        label: "Sentiment" },
    { key: "duration_seconds", label: "Duration seconds" },
    { key: "occurred_at",      label: "Created date" },
    { key: "deal_id",          label: "Deal ID" },
    { key: "company_id",       label: "Company ID" },
    { key: "source",           label: "Source" },
    { key: "created_at",       label: "Created date" },
    { key: "created_by",       label: "Created By" },
    { key: "related_to",       label: "Related To" },
  ],
  deals: [
    { key: "id",                        label: "Deal ID" },
    { key: "name",                      label: "Name" },
    { key: "stage",                     label: "Stage" },
    { key: "value",                     label: "Value" },
    { key: "currency",                  label: "Currency" },
    { key: "close_date",                label: "Close Date" },
    { key: "company_id",                label: "Company ID" },
    { key: "owner_id",                  label: "Owner ID" },
    { key: "reality_score",             label: "Reality Score" },
    { key: "created_at",                label: "Created date" },
    { key: "updated_at",                label: "Last update date" },
    { key: "created_by",                label: "Created by" },
    { key: "line_item",                 label: "Line Item" },
    { key: "value_usd",                 label: "Value ($)" },
    { key: "value_eur",                 label: "Value (\u20ac) Converted" },
    { key: "main_poc",                  label: "Main POC" },
    { key: "last_opportunity_activity", label: "Last opportunity Activity" },
  ],
  companies: [
    { key: "id",                    label: "Company ID" },
    { key: "name",                  label: "Name" },
    { key: "domain",                label: "Domain" },
    { key: "city",                  label: "City" },
    { key: "country",               label: "Country" },
    { key: "sub_region",            label: "Sub Region" },
    { key: "region",                label: "Region" },
    { key: "created_at",            label: "Created Date" },
    { key: "updated_at",            label: "Last update date" },
    { key: "created_by",            label: "Created by" },
    { key: "opportunities_name",    label: "Opportunity Name" },
    { key: "last_company_activity", label: "Last Company Activity" },
    { key: "linked_url",            label: "LinkedIn URL" },
    { key: "industry",              label: "Industry" },
    { key: "sub_industry",          label: "Sub Industry" },
    { key: "revenue",               label: "Revenue ($)" },
    { key: "employees",             label: "Employees" },
    { key: "segment",               label: "Segment" },
  ],
  contacts: [
    { key: "id",            label: "Contact ID" },
    { key: "firstName",     label: "First Name" },
    { key: "lastName",      label: "Last Name" },
    { key: "fullName",      label: "Full Name" },
    { key: "email",         label: "email" },
    { key: "title",         label: "Title" },
    { key: "seniority",     label: "Seniority" },
    { key: "isLead",        label: "Previous Lead" },
    { key: "created_at",    label: "Created date" },
    { key: "updated_at",    label: "Last update date" },
    { key: "created_by",    label: "Created by" },
    { key: "last_activity", label: "Last Contact Activity" },
  ],
  quotes: [
    { key: "id",           label: "Quote ID" },
    { key: "quote_number", label: "Quote Number" },
    { key: "title",        label: "Title" },
    { key: "status",       label: "Status" },
    { key: "company_name", label: "Company Name" },
    { key: "contact_name", label: "Contact Name" },
    { key: "total",        label: "Total" },
    { key: "subtotal",     label: "Subtotal" },
    { key: "currency",     label: "Currency" },
    { key: "valid_until",  label: "Valid Until" },
    { key: "created_at",   label: "Created At" },
    { key: "updated_at",   label: "Updated At" },
    { key: "created_by",   label: "Created By" },
    { key: "related_to",   label: "Related To" },
  ],
  users: [
    { key: "id",            label: "User ID" },
    { key: "first_name",    label: "First Name" },
    { key: "last_name",     label: "Last Name" },
    { key: "email",         label: "email" },
    { key: "role",          label: "Role" },
    { key: "can_quote",     label: "Can Quote" },
    { key: "country",       label: "Country" },
    { key: "timezone",      label: "Timezone" },
    { key: "language",      label: "language" },
    { key: "phone",         label: "Phone" },
    { key: "twilio_number", label: "Twilio Number" },
  ],
};

// Common join suggestions (auto-populated when sources selected)
const JOIN_SUGGESTIONS: Array<{ from: SourceId; to: SourceId; label: string; on: { left: string; right: string } }> = [
  { from: "activities", to: "deals",     label: "Activity → Deal",    on: { left: "deal_id",    right: "id" } },
  { from: "activities", to: "companies", label: "Activity → Company", on: { left: "company_id", right: "id" } },
  { from: "deals",      to: "companies", label: "Deal → Company",     on: { left: "company_id", right: "id" } },
  { from: "quotes",     to: "contacts",  label: "Quote → Contact",    on: { left: "contact_id", right: "id" } },
  { from: "quotes",     to: "deals",     label: "Quote → Deal",       on: { left: "deal_id",    right: "id" } },
  { from: "contacts",   to: "companies", label: "Contact → Company",  on: { left: "company_id", right: "id" } },
];

const PERIOD_OPTIONS = [
  { value: "",              label: "All time" },
  { value: "last_24_hours", label: "Last 24 hours" },
  { value: "last_7_days",   label: "Last 7 days" },
  { value: "last_30_days",  label: "Last 30 days" },
  { value: "last_90_days",  label: "Last 90 days" },
  { value: "last_year",     label: "Last year" },
  { value: "custom",        label: "Custom…" },
];

const FILTER_OPS = [
  { value: "eq",           label: "equals" },
  { value: "neq",          label: "not equals" },
  { value: "contains",     label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "gt",           label: "greater than" },
  { value: "gte",          label: "≥" },
  { value: "lt",           label: "less than" },
  { value: "lte",          label: "≤" },
  { value: "is_null",      label: "is empty" },
  { value: "not_null",     label: "is not empty" },
  { value: "in",           label: "in (comma-sep)" },
];

interface JoinDef {
  id:   string;
  type: JoinType;
  from: SourceId;
  to:   SourceId;
  on:   { left: string; right: string };
}

interface FilterRow {
  id:     string;
  source: SourceId;
  field:  string;
  op:     string;
  value:  string;
}

interface QueryResult {
  rows:     Record<string, unknown>[];
  columns:  string[];
  rowCount: number;
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step, total }: { step: number; total: number }) {
  const steps = ["Sources & Joins", "Fields & Filters", "Preview & Save"];
  return (
    <div className="flex items-center gap-0">
      {steps.map((label, i) => {
        const num  = i + 1;
        const done = num < step;
        const curr = num === step;
        return (
          <div key={i} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                done ? "bg-violet-600 text-foreground" : curr ? "bg-violet-600 text-foreground ring-2 ring-violet-400/40" : "bg-muted text-muted-foreground"
              )}>
                {done ? <Check className="h-3.5 w-3.5" /> : num}
              </div>
              <span className={cn("text-xs font-medium hidden sm:block", curr ? "text-foreground" : done ? "text-violet-300" : "text-muted-foreground")}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && <div className="mx-3 h-px w-8 bg-muted" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Sources & Joins ───────────────────────────────────────────────────

function Step1({ sources, setSources, joins, setJoins }: {
  sources:    SourceId[];
  setSources: (s: SourceId[]) => void;
  joins:      JoinDef[];
  setJoins:   (j: JoinDef[]) => void;
}) {
  function toggleSource(s: SourceId) {
    const next = sources.includes(s)
      ? sources.filter((x) => x !== s)
      : [...sources, s];
    setSources(next);
    // Auto-populate joins for newly suggested pairs
    if (!sources.includes(s)) {
      const newJoins = JOIN_SUGGESTIONS
        .filter((sug) => {
          const both = next.includes(sug.from) && next.includes(sug.to);
          const already = joins.some((j) => j.from === sug.from && j.to === sug.to);
          return both && !already;
        })
        .map((sug) => ({
          id:   crypto.randomUUID(),
          type: "LEFT" as JoinType,
          from: sug.from,
          to:   sug.to,
          on:   sug.on,
        }));
      if (newJoins.length) setJoins([...joins, ...newJoins]);
    } else {
      // Remove joins that reference the removed source
      setJoins(joins.filter((j) => j.from !== s && j.to !== s));
    }
  }

  function addJoin() {
    if (sources.length < 2) return;
    setJoins([...joins, {
      id:   crypto.randomUUID(),
      type: "LEFT",
      from: sources[0],
      to:   sources[1],
      on:   { left: "id", right: "id" },
    }]);
  }

  function updateJoin(id: string, patch: Partial<JoinDef>) {
    setJoins(joins.map((j) => j.id === id ? { ...j, ...patch } : j));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-base font-semibold text-foreground">Select data sources</h2>
        <p className="mb-4 text-xs text-muted-foreground">Choose which objects to include. Joins are auto-suggested between related sources.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(Object.keys(SOURCE_LABELS) as SourceId[]).map((s) => (
            <button
              key={s}
              onClick={() => toggleSource(s)}
              className={cn(
                "group relative rounded-xl border p-4 text-left transition-all",
                sources.includes(s)
                  ? "border-violet-500/60 bg-violet-500/10 text-foreground"
                  : "border-border bg-muted text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{SOURCE_LABELS[s]}</span>
                {sources.includes(s) && <Check className="h-4 w-4 text-violet-400" />}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{SOURCE_FIELDS[s].length} fields</p>
            </button>
          ))}
        </div>
      </div>

      {sources.length >= 2 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Joins</h3>
            <button onClick={addJoin} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300">
              <Plus className="h-3 w-3" />Add join
            </button>
          </div>

          {joins.length === 0 && (
            <p className="text-xs text-muted-foreground">No joins configured. Select a second source to auto-suggest joins, or add manually.</p>
          )}

          <div className="space-y-2">
            {joins.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted p-3">
                <select value={j.from} onChange={(e) => updateJoin(j.id, { from: e.target.value as SourceId })}
                  className="rounded bg-popover px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
                  {sources.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
                </select>
                <select value={j.type} onChange={(e) => updateJoin(j.id, { type: e.target.value as JoinType })}
                  className="rounded bg-popover px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
                  <option value="LEFT">LEFT JOIN</option>
                  <option value="INNER">INNER JOIN</option>
                </select>
                <select value={j.to} onChange={(e) => updateJoin(j.id, { to: e.target.value as SourceId })}
                  className="rounded bg-popover px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
                  {sources.filter((s) => s !== j.from).map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">ON</span>
                <select value={j.on.left} onChange={(e) => updateJoin(j.id, { on: { ...j.on, left: e.target.value } })}
                  className="rounded bg-popover px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
                  {SOURCE_FIELDS[j.from].map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">=</span>
                <select value={j.on.right} onChange={(e) => updateJoin(j.id, { on: { ...j.on, right: e.target.value } })}
                  className="rounded bg-popover px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
                  {SOURCE_FIELDS[j.to].map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <button onClick={() => setJoins(joins.filter((x) => x.id !== j.id))} className="ml-auto text-muted-foreground hover:text-red-400">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 2: Fields & Filters ──────────────────────────────────────────────────

function Step2({ sources, selectedFields, setSelectedFields, filters, setFilters, filterLogic, setFilterLogic, period, setPeriod, periodField, setPeriodField }: {
  sources:           SourceId[];
  selectedFields:    Record<string, boolean>;
  setSelectedFields: (f: Record<string, boolean>) => void;
  filters:           FilterRow[];
  setFilters:        (f: FilterRow[]) => void;
  filterLogic:       "AND" | "OR";
  setFilterLogic:    (l: "AND" | "OR") => void;
  period:            string;
  setPeriod:         (p: string) => void;
  periodField:       string;
  setPeriodField:    (p: string) => void;
}) {
  function toggleField(source: SourceId, field: string) {
    const key = `${source}.${field}`;
    setSelectedFields({ ...selectedFields, [key]: !selectedFields[key] });
  }

  function addFilter() {
    setFilters([...filters, {
      id: crypto.randomUUID(), source: sources[0], field: SOURCE_FIELDS[sources[0]][0].key, op: "eq", value: "",
    }]);
  }

  function updateFilter(id: string, patch: Partial<FilterRow>) {
    setFilters(filters.map((f) => f.id === id ? { ...f, ...patch } : f));
  }

  const dateFields = sources.flatMap((s) =>
    SOURCE_FIELDS[s]
      .filter((f) => f.key.includes("_at") || f.key.includes("date"))
      .map((f) => ({ key: `${s}.${f.key}`, label: `${SOURCE_LABELS[s]}.${f.label}` }))
  );

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Left: Field picker */}
      <div>
        <h2 className="mb-1 text-base font-semibold text-foreground">Select fields</h2>
        <p className="mb-4 text-xs text-muted-foreground">Leave all unchecked to auto-include the top fields from each source.</p>

        {/* Period filter */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="rounded bg-popover px-2 py-1.5 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
            {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {period === "custom" && (
            <input
              placeholder="e.g. last 24 hours, next 7 days, due today"
              className="w-56 rounded bg-popover px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:border-violet-500"
              onChange={(e) => setPeriod(e.target.value === "" ? "custom" : e.target.value)}
            />
          )}
          {period && period !== "custom" && dateFields.length > 0 && (
            <select value={periodField} onChange={(e) => setPeriodField(e.target.value)}
              className="rounded bg-popover px-2 py-1.5 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
              {dateFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          )}
        </div>

        <div className="space-y-4">
          {sources.map((s) => (
            <div key={s}>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-violet-300">{SOURCE_LABELS[s]}</h3>
                <button
                  onClick={() => {
                    const all: Record<string, boolean> = { ...selectedFields };
                    const allSelected = SOURCE_FIELDS[s].every((f) => selectedFields[`${s}.${f.key}`]);
                    SOURCE_FIELDS[s].forEach((f) => { all[`${s}.${f.key}`] = !allSelected; });
                    setSelectedFields(all);
                  }}
                  className="text-xs text-muted-foreground hover:text-muted-foreground"
                >
                  {SOURCE_FIELDS[s].every((f) => selectedFields[`${s}.${f.key}`]) ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {SOURCE_FIELDS[s].map((f) => {
                  const key = `${s}.${f.key}`;
                  return (
                    <label key={key} className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                      <input type="checkbox" checked={!!selectedFields[key]} onChange={() => toggleField(s, f.key)} className="accent-violet-500" />
                      {f.label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Filter builder */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Filters</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">All conditions must match (AND) or any (OR).</p>
          </div>
          <div className="flex rounded-full bg-muted p-0.5 text-xs">
            {(["AND","OR"] as const).map((l) => (
              <button key={l} onClick={() => setFilterLogic(l)}
                className={cn("rounded-full px-3 py-1 font-medium", filterLogic === l ? "bg-violet-600 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {filters.map((f, i) => (
            <div key={f.id} className="rounded-lg border border-border bg-muted p-3">
              {i > 0 && (
                <p className="mb-2 text-xs font-medium text-violet-400">{filterLogic}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <select value={f.source}
                  onChange={(e) => updateFilter(f.id, { source: e.target.value as SourceId, field: SOURCE_FIELDS[e.target.value as SourceId][0].key })}
                  className="rounded bg-popover px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
                  {sources.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
                </select>
                <select value={f.field} onChange={(e) => updateFilter(f.id, { field: e.target.value })}
                  className="rounded bg-popover px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
                  {SOURCE_FIELDS[f.source].map((fld) => <option key={fld.key} value={fld.key}>{fld.label}</option>)}
                </select>
                <select value={f.op} onChange={(e) => updateFilter(f.id, { op: e.target.value })}
                  className="rounded bg-popover px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:border-violet-500 [&>option]:bg-popover">
                  {FILTER_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {!["is_null","not_null"].includes(f.op) && (
                  <input value={f.value} onChange={(e) => updateFilter(f.id, { value: e.target.value })} placeholder="value"
                    className="w-28 rounded bg-muted px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:border-violet-500" />
                )}
                <button onClick={() => setFilters(filters.filter((x) => x.id !== f.id))} className="ml-auto text-muted-foreground hover:text-red-400">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addFilter} className="mt-3 flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300">
          <Plus className="h-3.5 w-3.5" />Add filter
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Preview & Save ────────────────────────────────────────────────────

function Step3({ spec, editId, onSaved }: {
  spec:    Record<string, unknown>;
  editId?: string | null;
  onSaved: () => void;
}) {
  const [previewResult, setPreviewResult] = useState<QueryResult | null>(null);
  const [running,       setRunning]       = useState(false);
  const [error,         setError]         = useState("");
  const [name,          setName]          = useState("");
  const [description,   setDescription]  = useState("");
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState("");

  async function handlePreview() {
    setRunning(true); setError("");
    try {
      const limitedSpec = { ...spec, limit: 20 };
      const res = await api.post("/api/v1/reports/run", { spec: limitedSpec });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: { message?: string } }).error?.message ?? "Preview failed");
      }
      setPreviewResult((await res.json()).data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to preview");
    } finally {
      setRunning(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) { setSaveError("Name is required"); return; }
    setSaving(true); setSaveError("");
    try {
      if (editId) {
        const res = await api.patch(`/api/v1/reports/${editId}`, {
          name: name.trim(), description: description.trim() || null, spec,
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await api.post("/api/v1/reports", {
          name: name.trim(), description: description.trim() || null, spec,
        });
        if (!res.ok) throw new Error(await res.text());
      }
      onSaved();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Preview */}
      <div>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">Preview</h2>
          <button onClick={handlePreview} disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run preview (20 rows)
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {previewResult ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted">
                  {previewResult.columns.map((col) => (
                    <th key={col} className="px-3 py-2 text-left text-muted-foreground whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewResult.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted">
                    {previewResult.columns.map((col) => (
                      <td key={col} className="max-w-[200px] truncate px-3 py-1.5 text-muted-foreground">
                        {row[col] == null ? <span className="text-muted-foreground">—</span> : String(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-1.5 text-xs text-muted-foreground">
              Preview: {previewResult.rowCount.toLocaleString()} rows total
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-border bg-muted py-10 text-xs text-muted-foreground">
            Click "Run preview" to see your data
          </div>
        )}
      </div>

      {/* Save */}
      <div className="max-w-md rounded-xl border border-border bg-muted p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">{editId ? "Update report" : "Save report"}</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name *"
          className="mb-2 w-full rounded bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:border-violet-500" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2}
          className="mb-4 w-full rounded bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:border-violet-500 resize-none" />
        {saveError && <p className="mb-3 text-xs text-red-400">{saveError}</p>}
        <button onClick={handleSave} disabled={saving}
          className="w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-foreground hover:bg-violet-500 disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : editId ? "Update Report" : "Save Report"}
        </button>
      </div>
    </div>
  );
}

// ── Main Builder ──────────────────────────────────────────────────────────────

function BuilderContent() {
  const t = useTranslations("reports");
  const router       = useRouter();
  const searchParams = useSearchParams();
  const editId       = searchParams.get("id");

  const [step,           setStep]           = useState(1);
  const [sources,        setSources]        = useState<SourceId[]>(["activities", "deals"]);
  const [joins,          setJoins]          = useState<JoinDef[]>([{
    id: "auto-1", type: "LEFT", from: "activities", to: "deals", on: { left: "deal_id", right: "id" },
  }]);
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
  const [filters,        setFilters]        = useState<FilterRow[]>([]);
  const [filterLogic,    setFilterLogic]    = useState<"AND" | "OR">("AND");
  const [period,         setPeriod]         = useState("");
  const [periodField,    setPeriodField]    = useState("activities.occurred_at");
  const [loading,        setLoading]        = useState(!!editId);

  // Load existing report for editing
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const res = await api.get(`/api/v1/reports/${editId}`);
        if (!res.ok) return;
        const json = await res.json();
        const s = json.data?.spec as Record<string, unknown>;
        if (!s) return;
        if (s.sources) setSources(s.sources as SourceId[]);
        if (s.joins)   setJoins((s.joins as JoinDef[]).map((j) => ({ ...j, id: crypto.randomUUID() })));
        if (s.fields) {
          const fields: Record<string, boolean> = {};
          (s.fields as Array<{ source: string; field: string }>).forEach(({ source, field }) => {
            fields[`${source}.${field}`] = true;
          });
          setSelectedFields(fields);
        }
        if (s.filters) {
          const fg = s.filters as { logic?: string; conditions?: unknown[] };
          if (fg.logic) setFilterLogic(fg.logic as "AND" | "OR");
          if (fg.conditions) {
            setFilters((fg.conditions as Array<{ source: SourceId; field: string; op: string; value?: unknown }>).map((c) => ({
              id:     crypto.randomUUID(),
              source: c.source,
              field:  c.field,
              op:     c.op,
              value:  c.value != null ? String(c.value) : "",
            })));
          }
        }
        const p = s.period as { field?: string; range?: string } | undefined;
        if (p?.range)  setPeriod(p.range);
        if (p?.field)  setPeriodField(p.field);
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  function buildSpec(): Record<string, unknown> {
    const allFields = Object.entries(selectedFields)
      .filter(([, v]) => v)
      .map(([key]) => {
        const [src, ...rest] = key.split(".");
        return { source: src, field: rest.join("."), alias: `${src}.${rest.join(".")}` };
      });

    const fields = allFields.length > 0
      ? allFields
      : sources.flatMap((s) => SOURCE_FIELDS[s].slice(0, 5).map((f) => ({ source: s, field: f.key, alias: `${s}.${f.key}` })));

    const conditions = filters
      .filter((f) => f.value || ["is_null","not_null"].includes(f.op))
      .map((f) => ({ source: f.source, field: f.field, op: f.op, value: f.value || undefined }));

    return {
      sources,
      joins:   joins.map(({ id: _id, ...j }) => j),
      fields,
      filters: { logic: filterLogic, conditions },
      ...(period ? { period: { field: periodField, range: period } } : {}),
      limit:   5000,
    };
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading report…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.push("/reports")}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />Back
        </button>
        <h1 className="text-xl font-bold text-foreground">{editId ? "Edit Report" : t("reportBuilder")}</h1>
      </div>

      <StepIndicator step={step} total={3} />

      {/* Step content */}
      <div className="min-h-[400px]">
        {step === 1 && (
          <Step1 sources={sources} setSources={setSources} joins={joins} setJoins={setJoins} />
        )}
        {step === 2 && (
          <Step2
            sources={sources}
            selectedFields={selectedFields} setSelectedFields={setSelectedFields}
            filters={filters} setFilters={setFilters}
            filterLogic={filterLogic} setFilterLogic={setFilterLogic}
            period={period} setPeriod={setPeriod}
            periodField={periodField} setPeriodField={setPeriodField}
          />
        )}
        {step === 3 && (
          <Step3 spec={buildSpec()} editId={editId} onSaved={() => router.push("/reports")} />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <button
          onClick={() => setStep((p) => Math.max(1, p - 1))}
          disabled={step === 1}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <ArrowLeft className="h-4 w-4" />Previous
        </button>

        {step < 3 ? (
          <button
            onClick={() => { if (sources.length > 0) setStep((p) => Math.min(3, p + 1)); }}
            disabled={sources.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-foreground hover:bg-violet-500 disabled:opacity-40"
          >
            Next<ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading…
      </div>
    }>
      <BuilderContent />
    </Suspense>
  );
}
