"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Layers, Plus, RefreshCw, AlertCircle, Play, Pause,
  Archive, Users, BarChart3, Settings2, ChevronRight, Mail, Phone, Linkedin,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/permissions";
import { SequenceBuilder }    from "@/components/sequences/SequenceBuilder";
import { EnrollmentManager }  from "@/components/sequences/EnrollmentManager";
import { SequenceAnalytics }  from "@/components/sequences/SequenceAnalytics";

interface Sequence {
  id:                   string;
  name:                 string;
  description:          string | null;
  status:               "draft" | "active" | "paused" | "archived";
  goal:                 string | null;
  active_enrollments:   number;
  completed_enrollments:number;
  owner_id:             string | null;
  created_at:           string;
}

type DetailTab = "builder" | "enrollments" | "analytics";

const STATUS_PILL: Record<string, string> = {
  draft:    "bg-muted text-muted-foreground",
  active:   "bg-green-100 text-green-700",
  paused:   "bg-yellow-100 text-yellow-700",
  archived: "bg-gray-100 text-gray-500",
};

export default function SequencesPage() {
  const perms = usePermissions();

  const [sequences,   setSequences]   = useState<Sequence[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [filter,      setFilter]      = useState<string>("active");
  const [selected,    setSelected]    = useState<Sequence | null>(null);
  const [detailTab,   setDetailTab]   = useState<DetailTab>("builder");
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId,   setEditingId]   = useState<string | undefined>(undefined);
  const [steps,       setSteps]       = useState<{ type: string }[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchSequences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      const res  = await api.get(`/api/v1/outreach/sequences?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to load");
      setSequences(json.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchSequences(); }, [fetchSequences]);

  // Load steps when a sequence is selected (for enrollment manager total steps)
  useEffect(() => {
    if (!selected) { setSteps([]); return; }
    api.get(`/api/v1/outreach/sequences/${selected.id}/steps`)
      .then((r) => r.json())
      .then((j) => setSteps(j.data ?? []))
      .catch(() => setSteps([]));
  }, [selected]);

  async function setStatus(seq: Sequence, status: "active" | "paused" | "archived") {
    setActionLoading(seq.id);
    try {
      await api.patch(`/api/v1/outreach/sequences/${seq.id}/status`, { status });
      fetchSequences();
      if (selected?.id === seq.id) setSelected({ ...seq, status });
    } catch { /* ignore */ }
    finally { setActionLoading(null); }
  }

  function openNew() {
    setEditingId(undefined);
    setShowBuilder(true);
  }

  function openEdit(seq: Sequence) {
    setEditingId(seq.id);
    setShowBuilder(true);
  }

  function onBuilderSaved(id: string) {
    setShowBuilder(false);
    fetchSequences();
    if (editingId) {
      // Re-fetch the updated sequence for the detail panel
      api.get(`/api/v1/outreach/sequences/${id}`)
        .then((r) => r.json())
        .then((j) => setSelected(j.data ?? null))
        .catch(() => {});
    }
  }

  // Full-screen builder
  if (showBuilder) {
    return (
      <div className="flex h-full flex-col">
        <SequenceBuilder
          sequenceId={editingId}
          onSaved={onBuilderSaved}
          onCancel={() => setShowBuilder(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4">
      {/* Left: sequence list */}
      <div className="flex w-80 shrink-0 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Sequences</h1>
          </div>
          <div className="flex gap-1">
            <button onClick={fetchSequences} disabled={loading} className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
            {perms.canWrite && (
              <button onClick={openNew} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 rounded-lg bg-muted p-1 mb-3">
          {["active", "draft", "paused", "all"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "flex-1 rounded-md py-1 text-xs font-medium capitalize transition-colors",
                filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}

        {/* Sequence list */}
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg border border-border p-3">
                <div className="mb-1.5 h-3.5 w-2/3 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted/60" />
              </div>
            ))
          ) : sequences.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Layers className="h-8 w-8 text-muted-foreground/30" />
              <p className="mt-2 text-sm text-muted-foreground">No sequences</p>
              {perms.canWrite && (
                <button onClick={openNew} className="mt-3 text-xs text-primary hover:underline">Create your first sequence</button>
              )}
            </div>
          ) : (
            sequences.map((seq) => (
              <button
                key={seq.id}
                onClick={() => { setSelected(seq); setDetailTab("builder"); }}
                className={cn(
                  "flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                  selected?.id === seq.id
                    ? "border-primary/40 bg-primary/5"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex-1 truncate text-sm font-medium">{seq.name}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", STATUS_PILL[seq.status])}>
                    {seq.status}
                  </span>
                </div>
                {seq.goal && <p className="truncate text-xs text-muted-foreground">{seq.goal}</p>}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{seq.active_enrollments} active</span>
                  <span>{seq.completed_enrollments} done</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: detail panel */}
      {selected ? (
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
          {/* Detail header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-base font-semibold">{selected.name}</h2>
              {selected.goal && <p className="text-xs text-muted-foreground">{selected.goal}</p>}
            </div>
            <div className="flex items-center gap-2">
              {/* Status actions */}
              {selected.status === "draft" && perms.canWrite && (
                <button
                  onClick={() => setStatus(selected, "active")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" /> Activate
                </button>
              )}
              {selected.status === "active" && perms.canWrite && (
                <button
                  onClick={() => setStatus(selected, "paused")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                >
                  <Pause className="h-3 w-3" /> Pause
                </button>
              )}
              {selected.status === "paused" && perms.canWrite && (
                <button
                  onClick={() => setStatus(selected, "active")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" /> Resume
                </button>
              )}
              {selected.status !== "archived" && perms.isManager && (
                <button
                  onClick={() => setStatus(selected, "archived")}
                  disabled={!!actionLoading}
                  className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title="Archive"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              )}
              {perms.canWrite && (
                <button
                  onClick={() => openEdit(selected)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Settings2 className="h-3.5 w-3.5" /> Edit
                </button>
              )}
            </div>
          </div>

          {/* Detail tabs */}
          <div className="flex border-b border-border px-6">
            {([
              { key: "builder",     label: "Steps",       icon: Layers },
              { key: "enrollments", label: "Enrollments", icon: Users },
              { key: "analytics",   label: "Analytics",   icon: BarChart3 },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setDetailTab(key)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-medium transition-colors",
                  detailTab === key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-6">
            {detailTab === "builder" && (
              <div className="space-y-3">
                {steps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Layers className="h-8 w-8 text-muted-foreground/30" />
                    <p className="mt-2 text-sm text-muted-foreground">No steps yet</p>
                    {perms.canWrite && (
                      <button onClick={() => openEdit(selected)} className="mt-3 text-xs text-primary hover:underline">
                        Add steps in the builder
                      </button>
                    )}
                  </div>
                ) : (
                  steps.map((step: any, i) => {
                    const TypeIcon = { email: Mail, call: Phone, linkedin_task: Linkedin }[step.type as string] ?? Mail;
                    return (
                      <div key={step.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {i + 1}
                        </div>
                        <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium capitalize">{step.type.replace("_", " ")}</span>
                          {step.subject_template && (
                            <p className="truncate text-xs text-muted-foreground">{step.subject_template}</p>
                          )}
                          {step.task_note && (
                            <p className="truncate text-xs text-muted-foreground">{step.task_note}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">Day {step.day_offset} · {step.time_of_day}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {detailTab === "enrollments" && (
              <EnrollmentManager sequenceId={selected.id} totalSteps={steps.length} />
            )}

            {detailTab === "analytics" && (
              <SequenceAnalytics sequenceId={selected.id} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border text-center">
          <Layers className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">Select a sequence</p>
            <p className="text-xs text-muted-foreground/70">Or create a new one to get started</p>
          </div>
          {perms.canWrite && (
            <button onClick={openNew} className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> New Sequence
            </button>
          )}
        </div>
      )}
    </div>
  );
}
