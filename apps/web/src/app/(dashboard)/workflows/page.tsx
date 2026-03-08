"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Layers, Plus, Play, Zap, AlertCircle, CheckCircle2, Clock,
  ArrowRight, X, Pencil, Trash2, Loader2, RefreshCw,
} from "lucide-react";
import { usePermissions } from "@/lib/permissions";
import { getStoredUser } from "@/lib/auth";
import { WorkflowActivePanel } from "@/components/workflows/workflow-active-panel";

interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  actions: string[];
  enabled: boolean;
  lastRun?: string;
  runCount: number;
  category: "deal" | "contact" | "activity" | "ai";
  createdBy?: string;
}

const CATEGORY_CFG: Record<string, { label: string; cls: string }> = {
  deal:     { label: "Deal",     cls: "bg-blue-100 text-blue-700" },
  contact:  { label: "Contact",  cls: "bg-purple-100 text-purple-700" },
  activity: { label: "Activity", cls: "bg-green-100 text-green-700" },
  ai:       { label: "AI",       cls: "bg-orange-100 text-orange-700" },
};

// ── Workflow Modal (create / edit) ─────────────────────────────────────────────

const TRIGGERS = [
  "Deal moved to Negotiation",
  "Deal moved to Closed Won",
  "Deal moved to Closed Lost",
  "Deal inactive for 7 days",
  "Deal value changes",
  "Contact auto-captured (confidence ≥ 90%)",
  "Contact created manually",
  "Lead score changes",
  "Meeting activity created",
  "Call activity completed",
  "Email received from contact",
  "Review queue item pending > 24h",
  "New deal created",
  "Task overdue",
  "Task completed",
  "Sequence step completed",
];

// ── Structured action menu ─────────────────────────────────────────────────────

interface ActionDef {
  section: string;
  action: string;
  value: string;
  configLabel?: string;
  configPlaceholder?: string;
}

const ACTION_MENU: ActionDef[] = [
  // Tasks & CRM
  { section: "Tasks & CRM",    action: "Create task",          value: "create_task",      configLabel: "Task title",        configPlaceholder: "e.g. Legal review" },
  { section: "Tasks & CRM",    action: "Assign to rep",        value: "assign_rep",       configLabel: "Rep email",         configPlaceholder: "rep@company.com"   },
  { section: "Tasks & CRM",    action: "Update deal stage",    value: "update_stage",     configLabel: "New stage",         configPlaceholder: "e.g. Negotiation"  },
  { section: "Tasks & CRM",    action: "Add tag",              value: "add_tag",          configLabel: "Tag",               configPlaceholder: "e.g. VIP"          },
  { section: "Tasks & CRM",    action: "Update CRM field",     value: "update_field",     configLabel: "Field: value",      configPlaceholder: "e.g. priority: high"},
  // Notifications
  { section: "Notifications",  action: "Notify owner via email", value: "notify_owner",   configLabel: "Message",           configPlaceholder: "Deal needs attention" },
  { section: "Notifications",  action: "Notify manager",       value: "notify_manager",   configLabel: "Message",           configPlaceholder: "Escalation needed"   },
  { section: "Notifications",  action: "Send Slack message",   value: "slack_message",    configLabel: "Channel",           configPlaceholder: "#channel or @user"   },
  { section: "Notifications",  action: "Send webhook",         value: "send_webhook",     configLabel: "Webhook URL",       configPlaceholder: "https://…"           },
  // Email
  { section: "Email",          action: "Send email",           value: "send_email",       configLabel: "Template / subject",configPlaceholder: "Welcome email"        },
  { section: "Email",          action: "Add to email sequence",value: "add_email_seq",    configLabel: "Sequence name",     configPlaceholder: "Nurture — Enterprise" },
  { section: "Email",          action: "Schedule follow-up email",value:"schedule_email", configLabel: "Delay (days)",      configPlaceholder: "3"                    },
  // Calling
  { section: "Calling",        action: "Add to call list",     value: "add_call_list",    configLabel: "List name",         configPlaceholder: "Hot prospects"         },
  { section: "Calling",        action: "Schedule call",        value: "schedule_call",    configLabel: "Delay (hours)",     configPlaceholder: "24"                    },
  // Sequences
  { section: "Sequences",      action: "Enrol in sequence",    value: "seq_enrol",        configLabel: "Sequence name",     configPlaceholder: "Onboarding — SMB"      },
  { section: "Sequences",      action: "Remove from sequence", value: "seq_remove",       configLabel: "Sequence name",     configPlaceholder: "Leave blank for all"   },
  { section: "Sequences",      action: "Pause sequence",       value: "seq_pause",        configLabel: "Reason",            configPlaceholder: "Deal in progress"       },
  // AI
  { section: "AI",             action: "Extract action items", value: "ai_extract",       configLabel: "Source field",      configPlaceholder: "meeting notes"          },
  { section: "AI",             action: "Score lead (AI)",      value: "ai_score",                                                                                       },
  { section: "AI",             action: "Summarise activity",   value: "ai_summarise",                                                                                   },
];

const ACTION_SECTIONS = [...new Set(ACTION_MENU.map((a) => a.section))];

function ActionRow({ index, value, onChange, onRemove }: {
  index: number;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  // Parse existing value: "action_value||config_text"
  const parts    = value.split("||");
  const actionVal = parts[0] ?? "";
  const configVal = parts[1] ?? "";
  const def = ACTION_MENU.find((a) => a.value === actionVal);

  const setActionType = (v: string) => onChange(v + (configVal ? "||" + configVal : ""));
  const setConfig     = (c: string) => onChange(actionVal + "||" + c);

  const grouped = ACTION_SECTIONS.map((sec) => ({
    section: sec,
    actions: ACTION_MENU.filter((a) => a.section === sec),
  }));

  const displayLabel = def ? def.action + (configVal ? ": " + configVal : "") : value;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {index + 1}
        </span>
        <select value={actionVal} onChange={(e) => setActionType(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="">— select action —</option>
          {grouped.map(({ section, actions }) => (
            <optgroup key={section} label={section}>
              {actions.map((a) => (
                <option key={a.value} value={a.value}>{a.action}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-red-600 shrink-0">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {def?.configLabel && (
        <div className="ml-7">
          <input value={configVal} onChange={(e) => setConfig(e.target.value)}
            placeholder={def.configPlaceholder ?? ""}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <p className="mt-0.5 text-xs text-muted-foreground">{def.configLabel}</p>
        </div>
      )}
    </div>
  );
}

interface WorkflowModalProps {
  initial?: Workflow;
  onClose: () => void;
  onSave: (wf: Omit<Workflow, "id" | "lastRun" | "runCount">) => void;
}

function WorkflowModal({ initial, onClose, onSave }: WorkflowModalProps) {
  const [name, setName]           = useState(initial?.name ?? "");
  const [description, setDesc]    = useState(initial?.description ?? "");
  const [trigger, setTrigger]     = useState(initial?.trigger ?? TRIGGERS[0]);
  const [category, setCategory]   = useState<Workflow["category"]>(initial?.category ?? "deal");
  const [actions, setActions]     = useState<string[]>(initial?.actions ?? [""]);

  const addAction    = () => setActions((a) => [...a, ""]);
  const removeAction = (i: number) => setActions((a) => a.filter((_, j) => j !== i));
  const setAction    = (i: number, v: string) =>
    setActions((a) => a.map((x, j) => (j === i ? v : x)));

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      trigger,
      actions: actions.filter((a) => a.trim()),
      enabled: initial?.enabled ?? true,
      category,
      createdBy: initial?.createdBy ?? "you",
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{initial ? "Edit Workflow" : "New Workflow"}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Workflow name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Deal → Negotiation: Legal task"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Description</label>
            <textarea value={description} onChange={(e) => setDesc(e.target.value)} rows={2}
              placeholder="What does this workflow do?"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Category</label>
            <div className="flex gap-2 flex-wrap">
              {(["deal", "contact", "activity", "ai"] as const).map((c) => (
                <button key={c} onClick={() => setCategory(c)}
                  className={cn("rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                    category === c ? CATEGORY_CFG[c].cls + " border-current" : "border-border text-muted-foreground hover:bg-muted")}>
                  {CATEGORY_CFG[c].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" /> Trigger
            </label>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium flex items-center gap-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-primary" /> Actions
            </label>
            <div className="space-y-2">
              {actions.map((action, i) => (
                <ActionRow
                  key={i}
                  index={i}
                  value={action}
                  onChange={(v) => setAction(i, v)}
                  onRemove={() => removeAction(i)}
                />
              ))}
            </div>
            <button onClick={addAction} className="mt-2 text-xs text-primary hover:underline flex items-center gap-1">
              <Plus className="h-3 w-3" /> Add action
            </button>
          </div>
        </div>

        <div className="flex gap-3 border-t px-6 py-4">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!name.trim()}
            className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
              !name.trim() ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
            {initial ? "Save changes" : "Create Workflow"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Filter = "all" | "deal" | "contact" | "activity" | "ai";

export default function WorkflowsPage() {
  const perms = usePermissions();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filter, setFilter]       = useState<Filter>("all");
  const [showCreate,    setShowCreate]    = useState(false);
  const [editing,       setEditing]       = useState<Workflow | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);
  const [mutating, setMutating]   = useState(false);
  const currentUser = getStoredUser()?.email ?? "";

  const mapApiWorkflow = (w: any): Workflow => ({
    id:          w.id,
    name:        w.name,
    description: w.description ?? "",
    trigger:     w.trigger?.label ?? (typeof w.trigger === "string" ? w.trigger : JSON.stringify(w.trigger)),
    actions:     (w.actions ?? []).map((a: any) => a.label ?? a.type ?? JSON.stringify(a)),
    enabled:     w.is_active ?? true,
    lastRun:     w.lastRun ?? null,
    runCount:    w.runCount ?? 0,
    category:    w.trigger?.category ?? w.category ?? "deal",
    createdBy:   w.createdBy ?? null,
  });

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/api/v1/workflows");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `Failed to load workflows (${res.status})`);
      }
      const json = await res.json();
      setWorkflows((json.data ?? []).map(mapApiWorkflow));
    } catch (err: any) {
      setError(err.message ?? "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const toggle = async (id: string) => {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) return;
    const newEnabled = !wf.enabled;
    setWorkflows((ws) => ws.map((w) => w.id === id ? { ...w, enabled: newEnabled } : w));
    try {
      const res = await api.patch(`/api/v1/workflows/${id}`, { is_active: newEnabled });
      if (!res.ok) throw new Error("Toggle failed");
    } catch {
      setWorkflows((ws) => ws.map((w) => w.id === id ? { ...w, enabled: wf.enabled } : w));
    }
  };

  const handleCreate = async (data: Omit<Workflow, "id" | "lastRun" | "runCount">) => {
    setMutating(true);
    try {
      const res = await api.post("/api/v1/workflows", {
        name:        data.name,
        description: data.description,
        trigger:     { label: data.trigger, category: data.category },
        actions:     data.actions.map((a) => ({ label: a })),
        is_active:   data.enabled,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? "Failed to create workflow");
      }
      const json = await res.json();
      const created = mapApiWorkflow(json.data);
      setWorkflows((ws) => [created, ...ws]);
    } catch (err: any) {
      setError(err.message ?? "Failed to create workflow");
    } finally {
      setMutating(false);
    }
  };

  const handleEdit = async (id: string, data: Omit<Workflow, "id" | "lastRun" | "runCount">) => {
    const prev = workflows.find((w) => w.id === id);
    setWorkflows((ws) => ws.map((w) => w.id === id ? { ...w, ...data } : w));
    try {
      const res = await api.patch(`/api/v1/workflows/${id}`, {
        name:        data.name,
        description: data.description,
        is_active:   data.enabled,
        trigger:     { label: data.trigger, category: data.category },
        actions:     data.actions.map((a) => ({ label: a })),
      });
      if (!res.ok) {
        throw new Error("Failed to update workflow");
      }
    } catch {
      if (prev) setWorkflows((ws) => ws.map((w) => w.id === id ? prev : w));
      setError("Failed to update workflow");
    }
  };

  const handleDelete = async (id: string) => {
    const prev = workflows;
    setWorkflows((ws) => ws.filter((w) => w.id !== id));
    try {
      const res = await api.delete(`/api/v1/workflows/${id}`);
      if (!res.ok && res.status !== 204) {
        throw new Error("Failed to delete workflow");
      }
    } catch {
      setWorkflows(prev);
      setError("Failed to delete workflow");
    }
  };

  // A user can edit a workflow if they're admin/manager, or if they created it
  const canEdit = (wf: Workflow) =>
    perms.canWrite && (perms.canManageUsers || wf.createdBy === currentUser);

  const filtered = filter === "all" ? workflows : workflows.filter((w) => w.category === filter);
  const active   = workflows.filter((w) => w.enabled).length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Workflows</h1>
          {!loading && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {active} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchWorkflows}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
            title="Refresh workflows"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            disabled={mutating}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> New Workflow
          </button>
        </div>
      </div>

      {showCreate && (
        <WorkflowModal onClose={() => setShowCreate(false)} onSave={handleCreate} />
      )}
      {editing && (
        <WorkflowModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(data) => { handleEdit(editing.id, data); setEditing(null); }}
        />
      )}
      {activeWorkflow && (
        <WorkflowActivePanel
          workflow={activeWorkflow}
          onClose={() => setActiveWorkflow(null)}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="shrink-0 hover:text-red-900">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700">
        <Zap className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Workflows run automatically based on triggers. They replace manual follow-ups and ensure every deal gets the right attention at the right time.</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["all", "deal", "contact", "activity", "ai"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >{f === "all" ? "All" : CATEGORY_CFG[f].label}</button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading workflows...</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && workflows.length === 0 && (
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Layers className="h-10 w-10" />
            <p className="text-sm font-medium">No workflows yet</p>
            <p className="text-xs">Create your first workflow to automate your CRM processes.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New Workflow
            </button>
          </div>
        </div>
      )}

      {/* Workflow cards */}
      {!loading && filtered.length > 0 && (
      <div className="flex-1 overflow-auto">
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((wf) => (
            <div key={wf.id} className={cn("rounded-xl border bg-card p-5 transition-opacity", !wf.enabled && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <button
                  className="min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
                  onClick={() => setActiveWorkflow(wf)}
                  title="Click to see active entities"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", CATEGORY_CFG[wf.category].cls)}>
                      {CATEGORY_CFG[wf.category].label}
                    </span>
                    {wf.enabled
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      : <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </div>
                  <h3 className="font-semibold text-sm">{wf.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{wf.description}</p>
                </button>

                {/* Controls */}
                <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {canEdit(wf) && (
                    <button
                      onClick={() => setEditing(wf)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Edit workflow"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* Toggle */}
                  <button
                    onClick={() => toggle(wf.id)}
                    className={cn(
                      "flex h-7 w-12 items-center rounded-full px-1 transition-colors",
                      wf.enabled ? "bg-primary justify-end" : "bg-muted justify-start"
                    )}
                    title={wf.enabled ? "Disable workflow" : "Enable workflow"}
                  >
                    <div className="h-5 w-5 rounded-full bg-background shadow-sm" />
                  </button>
                </div>
              </div>

              {/* Trigger → actions */}
              <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs">
                <div className="flex items-start gap-2 mb-2">
                  <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <span className="font-medium text-foreground">{wf.trigger}</span>
                </div>
                <div className="space-y-1 pl-5">
                  {wf.actions.map((action, i) => {
                    const parts = action.split("||");
                    const def = ACTION_MENU.find((a) => a.value === parts[0]);
                    const label = def ? def.action + (parts[1] ? ": " + parts[1] : "") : action;
                    return (
                      <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        {label}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stats */}
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <button
                  onClick={() => setActiveWorkflow(wf)}
                  className="flex items-center gap-1 hover:text-primary transition-colors"
                  title="View active entities"
                >
                  <Play className="h-3 w-3" /> {wf.runCount} runs
                </button>
                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  {wf.lastRun && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Last run {wf.lastRun}
                    </span>
                  )}
                  {canEdit(wf) && (
                    <button
                      onClick={() => handleDelete(wf.id)}
                      className="text-muted-foreground hover:text-red-600 transition-colors"
                      title="Delete workflow"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
