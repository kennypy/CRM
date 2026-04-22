"use client";

import { useState } from "react";
import { CheckCircle2, Clock, AlertTriangle, XCircle, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type JobStatus =
  | "pending"
  | "in_flight"
  | "delivered"
  | "stuck"
  | "dead_letter";

export interface DeliveryJob {
  id: string;
  messageId: string | null;
  kind: "reply" | "resolve" | "assign";
  status: JobStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  updatedAt: string;
}

interface Props {
  job: DeliveryJob;
  onRetried: () => void;
}

/**
 * Renders a small pill next to an agent reply reflecting the outbound
 * delivery state. dead_letter is the only state with a user-driven action
 * (retry) — the rest are observational. All other state changes come from
 * the dispatcher / reconcile workers polling behind the scenes.
 */
export function DeliveryChip({ job, onRetried }: Props) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const res = await api.post(`/api/v1/support-tickets/jobs/${job.id}/retry`, {});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onRetried();
    } catch (e: any) {
      setError(e?.message ?? "Failed to retry");
    } finally {
      setRetrying(false);
    }
  }

  const cfg = STATUS_CFG[job.status];

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        title={tooltipFor(job)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
          cfg.className,
        )}
      >
        <cfg.icon className="h-3 w-3" />
        {cfg.label}
        {job.attempts > 1 && job.status !== "delivered" && (
          <span className="opacity-70">· {job.attempts} tries</span>
        )}
      </span>
      {job.status === "dead_letter" && (
        <button
          onClick={retry}
          disabled={retrying}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
          title="Retry delivery to Vintage"
        >
          <RotateCw className={cn("h-3 w-3", retrying && "animate-spin")} />
          Retry
        </button>
      )}
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}

const STATUS_CFG: Record<JobStatus, { icon: typeof CheckCircle2; label: string; className: string }> = {
  pending:     { icon: Clock,         label: "Queued",       className: "bg-slate-100 text-slate-700" },
  in_flight:   { icon: Clock,         label: "Sending",      className: "bg-blue-100 text-blue-700" },
  delivered:   { icon: CheckCircle2,  label: "Delivered",    className: "bg-green-100 text-green-700" },
  stuck:       { icon: AlertTriangle, label: "Stuck",        className: "bg-amber-100 text-amber-700" },
  dead_letter: { icon: XCircle,       label: "Failed",       className: "bg-red-100 text-red-700" },
};

function tooltipFor(job: DeliveryJob): string {
  if (job.status === "delivered" && job.deliveredAt) {
    return `Delivered ${new Date(job.deliveredAt).toLocaleString()}`;
  }
  if (job.lastError) {
    const code = job.lastStatusCode ? ` (HTTP ${job.lastStatusCode})` : "";
    return `${job.status}${code}: ${job.lastError}`;
  }
  return job.status;
}
