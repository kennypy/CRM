"use client";

/**
 * Workflows — builder + list. Triggers, trigger options, actions and action
 * config fields all come from the gateway's automation catalog
 * (GET /api/v1/workflows/catalog), and saves send the structured definition the
 * engine executes: trigger {type,...}, conditions [{field,operator,value}],
 * actions [{type, config, delayMinutes}]. Rows saved by the old builder
 * (label-only, never executable) are flagged "Needs setup".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Clock, Filter as FilterIcon, Layers,
  Loader2, Pencil, Play, Plus, RefreshCw, Trash2, X, Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/permissions";
import { getStoredUser } from "@/lib/auth";
import { readApiError, useOrgTeams, useOrgUsers, userName } from "@/lib/l2q";
import {
  KIND_OPTIONS, MAX_DELAY_MINUTES, UNARY_OPERATORS,
  actionSummaries, actionsForTrigger, buildWorkflowBody, conditionFieldSuggestions, draftFromRow,
  emptyAction, emptyDraft, rowCategory, triggerLabel, useAutomationCatalog, useSequences, validateDraft,
  type AutomationCatalog, type CatalogAction, type CatalogActionField, type DraftAction,
  type WorkflowCategory, type WorkflowDraft, type WorkflowRow,
} from "@/lib/automation";
import { WorkflowRunsPanel } from "@/components/workflows/workflow-active-panel";

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const smallInputCls = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

/** Translate a dynamic key, falling back to raw text when no message exists. */
function tx(t: { has: (k: never) => boolean; (k: never): string }, key: string, fallback: string): string {
  return t.has(key as never) ? t(key as never) : fallback;
}

const CATEGORY_CLS: Record<WorkflowCategory, string> = {
  deal: "bg-blue-100 text-blue-700",
  contact: "bg-purple-100 text-purple-700",
  activity: "bg-green-100 text-green-700",
  quote: "bg-amber-100 text-amber-800",
  other: "bg-muted text-muted-foreground",
};

// ── Field inputs ──────────────────────────────────────────────────────────────

function OptionSelect({ kind, value, onChange, required }: {
  kind: keyof typeof KIND_OPTIONS; value: string; onChange: (v: string) => void; required?: boolean;
}) {
  const t = useTranslations("automation");
  const opts = KIND_OPTIONS[kind] ?? [];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={smallInputCls}>
      {!required && <option value="">{t("none")}</option>}
      {opts.map((o) => (
        <option key={o} value={o}>{tx(t, `opt.${o}`, o)}</option>
      ))}
    </select>
  );
}

function FieldInput({ field, value, onChange }: {
  field: CatalogActionField; value: string; onChange: (v: string) => void;
}) {
  const t = useTranslations("automation");
  const users = useOrgUsers();
  const teams = useOrgTeams();
  const sequences = useSequences(field.kind === "sequence");

  switch (field.kind) {
    case "text":
      return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={cn(smallInputCls, "resize-y")} />;
    case "number":
      return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={smallInputCls} />;
    case "url":
      return <input type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" className={smallInputCls} />;
    case "stage": case "priority": case "recipient": case "emailTo": case "assignMode": case "channels":
      return <OptionSelect kind={field.kind} value={value} onChange={onChange} required={field.required} />;
    case "user":
      // Non-admins get 403 from /users → free-text user id fallback.
      return users.length ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={smallInputCls}>
          <option value="">{t("selectUser")}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{userName(u)}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("userIdPlaceholder")} className={smallInputCls} />
      );
    case "team":
      return teams.length ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={smallInputCls}>
          <option value="">{t("selectTeam")}</option>
          {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("teamIdPlaceholder")} className={smallInputCls} />
      );
    case "sequence":
      return sequences.length ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={smallInputCls}>
          <option value="">{t("selectSequence")}</option>
          {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("sequenceIdPlaceholder")} className={smallInputCls} />
      );
    default:
      return <input value={value} onChange={(e) => onChange(e.target.value)} className={smallInputCls} />;
  }
}

function ActionEditor({ index, action, defs, onChange, onRemove }: {
  index: number;
  action: DraftAction;
  defs: CatalogAction[];
  onChange: (a: DraftAction) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("automation");
  const def = defs.find((d) => d.type === action.type);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {index + 1}
        </span>
        <select
          value={def ? action.type : ""}
          onChange={(e) => {
            const next = defs.find((d) => d.type === e.target.value);
            onChange(next ? { ...emptyAction(next), delayMinutes: action.delayMinutes } : { ...action, type: e.target.value });
          }}
          className={cn(smallInputCls, "flex-1")}
        >
          <option value="">{t("selectAction")}</option>
          {defs.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
        </select>
        <button type="button" onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-red-600" aria-label={t("removeAction")}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {!def && action.type && (
        <p className="ml-7 flex items-center gap-1 text-xs text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" /> {t("unsupportedAction", { type: action.type })}
        </p>
      )}
      {def && (
        <div className="ml-7 grid gap-2">
          {def.fields.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-0.5 block text-xs text-muted-foreground">
                {f.label}{f.required && <span className="text-red-600"> *</span>}
              </span>
              <FieldInput field={f} value={action.config[f.key] ?? ""}
                onChange={(v) => onChange({ ...action, config: { ...action.config, [f.key]: v } })} />
            </label>
          ))}
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted-foreground">{t("delayMinutes")}</span>
            <input type="number" min={0} max={MAX_DELAY_MINUTES} value={action.delayMinutes}
              onChange={(e) => onChange({ ...action, delayMinutes: e.target.value })}
              placeholder="0" className={cn(smallInputCls, "w-32")} />
          </label>
        </div>
      )}
    </div>
  );
}

// ── Builder modal ─────────────────────────────────────────────────────────────

function WorkflowModal({ catalog, initial, onClose, onSaved }: {
  catalog: AutomationCatalog;
  initial: WorkflowDraft;
  onClose: () => void;
  onSaved: (row: WorkflowRow) => void;
}) {
  const t = useTranslations("automation");
  const [d, setD] = useState<WorkflowDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  const trigDef = catalog.triggers.find((tr) => tr.type === d.triggerType);
  const actionDefs = useMemo(() => actionsForTrigger(catalog, d.triggerType), [catalog, d.triggerType]);
  const suggestions = useMemo(() => conditionFieldSuggestions(catalog, d.triggerType), [catalog, d.triggerType]);

  const update = (patch: Partial<WorkflowDraft>) => setD((cur) => ({ ...cur, ...patch }));

  const save = async () => {
    const problems = validateDraft(d, catalog);
    if (problems.length) {
      setError(t("fixProblems"));
      setDetails(problems.map((p) => {
        const [head, tail] = p.split(/[.:]/);
        if (head === "action") return t("problem.unknownAction", { type: tail ?? "?" });
        if (tail) {
          const def = catalog.actions.find((a) => a.type === head);
          const field = def?.fields.find((f) => f.key === tail);
          return t("problem.actionField", { action: def?.label ?? head, field: field?.label ?? tail });
        }
        return tx(t, `problem.${head}`, p);
      }));
      return;
    }
    setBusy(true); setError(null); setDetails([]);
    try {
      const body = buildWorkflowBody(d, catalog);
      const res = d.id ? await api.patch(`/api/v1/workflows/${d.id}`, body) : await api.post("/api/v1/workflows", body);
      if (!res.ok) {
        const json = await res.clone().json().catch(() => ({}));
        const info = await readApiError(res, t("saveFailed"));
        setError(info.message);
        const issues = ((json as { error?: { details?: { message?: string }[] } }).error?.details ?? [])
          .map((x) => x.message).filter((m): m is string => !!m);
        setDetails([...new Set(issues)].filter((m) => m !== info.message));
        return;
      }
      const json = await res.json();
      onSaved(json.data as WorkflowRow);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{d.id ? t("editWorkflow") : t("newWorkflow")}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t("close")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">{t("name")} *</span>
              <input value={d.name} onChange={(e) => update({ name: e.target.value })} placeholder={t("namePlaceholder")} className={inputCls} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">{t("description")}</span>
              <textarea value={d.description} onChange={(e) => update({ description: e.target.value })} rows={2} className={cn(inputCls, "resize-none")} />
            </label>
          </div>

          {/* Trigger */}
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Zap className="h-3.5 w-3.5 text-primary" /> {t("trigger")}</h3>
            <select value={d.triggerType}
              onChange={(e) => update({ triggerType: e.target.value, triggerOptions: {} })}
              className={inputCls}>
              {catalog.triggers.map((tr) => <option key={tr.type} value={tr.type}>{tr.label}</option>)}
            </select>
            {trigDef?.options?.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {trigDef.options.map((o) => (
                  <label key={o.key} className="block">
                    <span className="mb-0.5 block text-xs text-muted-foreground">{o.label}</span>
                    {o.kind === "number" ? (
                      <input type="number" min={0} max={100} value={d.triggerOptions[o.key] ?? ""}
                        onChange={(e) => update({ triggerOptions: { ...d.triggerOptions, [o.key]: e.target.value } })}
                        className={smallInputCls} />
                    ) : (
                      <OptionSelect kind={o.kind} value={d.triggerOptions[o.key] ?? ""}
                        onChange={(v) => update({ triggerOptions: { ...d.triggerOptions, [o.key]: v } })} />
                    )}
                  </label>
                ))}
              </div>
            ) : null}
          </section>

          {/* Conditions */}
          <section>
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium"><FilterIcon className="h-3.5 w-3.5 text-primary" /> {t("conditions")}</h3>
            <p className="mb-2 text-xs text-muted-foreground">{t("conditionsHelp")}</p>
            <datalist id="wf-condition-fields">
              {suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
            <div className="space-y-2">
              {d.conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input list="wf-condition-fields" value={c.field} placeholder={t("field")}
                    onChange={(e) => update({ conditions: d.conditions.map((x, j) => j === i ? { ...x, field: e.target.value } : x) })}
                    className={cn(smallInputCls, "flex-1")} />
                  <select value={c.operator}
                    onChange={(e) => update({ conditions: d.conditions.map((x, j) => j === i ? { ...x, operator: e.target.value } : x) })}
                    className={cn(smallInputCls, "w-36")}>
                    {catalog.conditionOperators.map((op) => (
                      <option key={op} value={op}>{tx(t, `op.${op}`, op)}</option>
                    ))}
                  </select>
                  {!UNARY_OPERATORS.has(c.operator) && (
                    <input value={c.value} placeholder={c.operator === "in" ? t("commaSeparated") : t("value")}
                      onChange={(e) => update({ conditions: d.conditions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })}
                      className={cn(smallInputCls, "flex-1")} />
                  )}
                  <button type="button" onClick={() => update({ conditions: d.conditions.filter((_, j) => j !== i) })}
                    className="shrink-0 text-muted-foreground hover:text-red-600" aria-label={t("removeCondition")}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => update({ conditions: [...d.conditions, { field: "", operator: "equals", value: "" }] })}
              className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus className="h-3 w-3" /> {t("addCondition")}
            </button>
          </section>

          {/* Actions */}
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><ArrowRight className="h-3.5 w-3.5 text-primary" /> {t("actions")}</h3>
            <div className="space-y-2">
              {d.actions.map((a, i) => (
                <ActionEditor key={i} index={i} action={a} defs={actionDefs}
                  onChange={(next) => update({ actions: d.actions.map((x, j) => j === i ? next : x) })}
                  onRemove={() => update({ actions: d.actions.filter((_, j) => j !== i) })} />
              ))}
            </div>
            <button type="button" onClick={() => update({ actions: [...d.actions, { type: "", config: {}, delayMinutes: "" }] })}
              className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus className="h-3 w-3" /> {t("addAction")}
            </button>
          </section>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.isActive} onChange={(e) => update({ isActive: e.target.checked })} />
            {t("activeOnSave")}
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 text-xs text-red-700">
              <p className="flex items-center gap-1.5 font-medium"><AlertCircle className="h-4 w-4 shrink-0" /> {error}</p>
              {details.length > 0 && (
                <ul className="ml-6 mt-1 list-disc space-y-0.5">{details.map((x, i) => <li key={i}>{x}</li>)}</ul>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
            {t("cancel")}
          </button>
          <button onClick={save} disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {d.id ? t("saveChanges") : t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Filter = "all" | WorkflowCategory | "needsSetup";

export default function WorkflowsPage() {
  const t = useTranslations("automation");
  const tw = useTranslations("workflows");
  const perms = usePermissions();
  const { catalog, error: catalogError } = useAutomationCatalog();
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<WorkflowDraft | null>(null);
  const [runsFor, setRunsFor] = useState<WorkflowRow | null>(null);
  const currentUserId = getStoredUser()?.id ?? "";

  const fetchWorkflows = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get("/api/v1/workflows");
      if (!res.ok) throw await readApiError(res, t("loadFailed"));
      const json = await res.json();
      setRows((json.data ?? []) as WorkflowRow[]);
    } catch (e) {
      setError((e as { message?: string }).message ?? t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  const toggle = async (row: WorkflowRow) => {
    if (row.needsSetup) return;
    const next = !row.is_active;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: next } : r)));
    const res = await api.patch(`/api/v1/workflows/${row.id}`, { is_active: next }).catch(() => null);
    if (!res || !res.ok) {
      const info = res ? await readApiError(res, t("toggleFailed")) : { message: t("toggleFailed") };
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: row.is_active } : r)));
      setError(info.message);
    }
  };

  const remove = async (row: WorkflowRow) => {
    if (!window.confirm(t("confirmDelete", { name: row.name }))) return;
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.id !== row.id));
    const res = await api.delete(`/api/v1/workflows/${row.id}`).catch(() => null);
    if (!res || (!res.ok && res.status !== 204)) {
      setRows(prev);
      setError(t("deleteFailed"));
    }
  };

  const onSaved = (row: WorkflowRow) => {
    setRows((rs) => (rs.some((r) => r.id === row.id) ? rs.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [row, ...rs]));
    setEditing(null);
  };

  const canEdit = (row: WorkflowRow) => perms.canWrite && (perms.canManageUsers || row.createdBy === currentUserId);

  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "needsSetup") return !!r.needsSetup;
    return rowCategory(r, catalog) === filter;
  });
  const activeCount = rows.filter((r) => r.is_active && !r.needsSetup).length;
  const setupCount = rows.filter((r) => r.needsSetup).length;
  const filters: Filter[] = ["all", "deal", "contact", "activity", "quote", "other", ...(setupCount ? ["needsSetup" as const] : [])];

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{tw("title")}</h1>
          {!loading && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {t("activeCount", { count: activeCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchWorkflows} disabled={loading} title={t("refresh")}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => catalog && setEditing(emptyDraft(catalog))} disabled={!catalog || !perms.canWrite}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            <Plus className="h-4 w-4" /> {tw("newWorkflow")}
          </button>
        </div>
      </div>

      {editing && catalog && (
        <WorkflowModal catalog={catalog} initial={editing} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
      {runsFor && (
        <WorkflowRunsPanel
          workflow={{ id: runsFor.id, name: runsFor.name, trigger: triggerLabel(runsFor, catalog) }}
          onClose={() => setRunsFor(null)} />
      )}

      {(error || catalogError) && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p className="flex-1">{error ?? t("catalogFailed", { error: catalogError ?? "" })}</p>
          {error && <button onClick={() => setError(null)} className="shrink-0 hover:text-red-900"><X className="h-3.5 w-3.5" /></button>}
        </div>
      )}

      {setupCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("needsSetupBanner", { count: setupCount })}</p>
        </div>
      )}

      <div className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
        {filters.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {t(`filter.${f}` as never)}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" /> {t("loading")}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <Layers className="h-10 w-10" />
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="text-xs">{t("emptyBody")}</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex-1 overflow-auto">
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((row) => {
              const cat = rowCategory(row, catalog);
              const enabled = row.is_active && !row.needsSetup;
              return (
                <div key={row.id} className={cn("rounded-xl border bg-card p-5", !enabled && "opacity-80")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", CATEGORY_CLS[cat])}>
                          {t(`filter.${cat}` as never)}
                        </span>
                        {row.needsSetup ? (
                          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                            title={row.setupReason ?? ""}>
                            <AlertTriangle className="h-3 w-3" /> {t("needsSetup", { reason: row.setupReason ?? "" })}
                          </span>
                        ) : enabled ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <h3 className="text-sm font-semibold">{row.name}</h3>
                      {row.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canEdit(row) && (
                        <button onClick={() => setEditing(draftFromRow(row, catalog))} disabled={!catalog}
                          className={cn("rounded p-1 hover:bg-muted", row.needsSetup ? "text-amber-700" : "text-muted-foreground hover:text-foreground")}
                          title={row.needsSetup ? t("fixSetup") : t("edit")}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => toggle(row)} disabled={!!row.needsSetup || !canEdit(row)}
                        className={cn("flex h-7 w-12 items-center rounded-full px-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          enabled ? "justify-end bg-primary" : "justify-start bg-muted")}
                        title={row.needsSetup ? t("cannotActivate") : enabled ? t("disable") : t("enable")}>
                        <div className="h-5 w-5 rounded-full bg-background shadow-sm" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs">
                    <div className="mb-2 flex items-start gap-2">
                      <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                      <span className="font-medium text-foreground">{triggerLabel(row, catalog)}</span>
                    </div>
                    {Array.isArray(row.conditions) && row.conditions.length > 0 && (
                      <p className="mb-1 pl-5 text-muted-foreground">{t("conditionCount", { count: row.conditions.length })}</p>
                    )}
                    <div className="space-y-1 pl-5">
                      {actionSummaries(row, catalog).map((s, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
                          <ArrowRight className="h-3 w-3 shrink-0" /> {s}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <button onClick={() => setRunsFor(row)} className="flex items-center gap-1 hover:text-primary">
                      <Play className="h-3 w-3" /> {t("runsLink", { count: row.runCount ?? 0 })}
                    </button>
                    <div className="flex items-center gap-3">
                      {row.lastRun && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {new Date(row.lastRun).toLocaleString()}
                        </span>
                      )}
                      {canEdit(row) && (
                        <button onClick={() => remove(row)} className="hover:text-red-600" title={t("delete")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
