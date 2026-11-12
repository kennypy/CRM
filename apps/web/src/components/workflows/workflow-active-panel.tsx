"use client";

/**
 * Workflow run history — real data from GET /api/v1/workflows/:id/runs.
 * (This panel previously rendered hard-coded demo entities and runs.) Shows
 * each run's status and per-step results so failed or skipped actions are
 * visible instead of silently "succeeding".
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, X, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { getData, errorMessage } from "@/lib/l2q";
import type { WorkflowRun } from "@/lib/automation";

const STATUS_CLS: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  running: "bg-blue-100 text-blue-700",
  cancelled: "bg-muted text-muted-foreground",
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function WorkflowRunsPanel({
  workflow, onClose,
}: {
  workflow: { id: string; name: string; trigger: string };
  onClose: () => void;
}) {
  const t = useTranslations("automation");
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRuns(await getData<WorkflowRun[]>(`/api/v1/workflows/${workflow.id}/runs`));
    } catch (e) {
      setError(errorMessage(e, t("runsLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [workflow.id, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{workflow.name}</h2>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Zap className="h-3 w-3 text-primary" /> {workflow.trigger}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={load} disabled={loading} title={t("refresh")}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:bg-muted" aria-label={t("close")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("recentRuns")}</h3>
          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && runs.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("noRuns")}</p>
          )}
          <ul className="space-y-2">
            {runs.map((r) => {
              const steps = Array.isArray(r.steps_log) ? r.steps_log : [];
              const failedSteps = steps.filter((s) => !s.success).length;
              return (
                <li key={r.id} className="rounded-lg border">
                  <button onClick={() => setOpen(open === r.id ? null : r.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
                    {r.status === "completed" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                      : r.status === "failed" ? <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                      : <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLS[r.status] ?? "bg-muted")}>
                      {t.has(`runStatus.${r.status}` as never) ? t(`runStatus.${r.status}` as never) : r.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {r.trigger_event?.event_type ?? ""} · {fmt(r.started_at)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("stepsCount", { count: steps.length, failed: failedSteps })}
                    </span>
                  </button>
                  {open === r.id && (
                    <div className="space-y-1 border-t bg-muted/20 px-3 py-2 text-xs">
                      {r.error_message && <p className="text-red-700">{r.error_message}</p>}
                      {r.trigger_event?.entity_id && (
                        <p className="text-muted-foreground">
                          {t("record")}: {r.trigger_event.entity_type} {r.trigger_event.entity_id}
                        </p>
                      )}
                      {steps.length === 0 && <p className="text-muted-foreground">{t("noSteps")}</p>}
                      {steps.map((s, i) => (
                        <div key={i} className="flex items-start gap-2">
                          {s.success
                            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                            : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />}
                          <span className="font-medium">{s.action}</span>
                          <span className={cn("min-w-0 flex-1 break-words", s.success ? "text-muted-foreground" : "text-red-700")}>
                            {s.result}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
}
