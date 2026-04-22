"use client";

import { useState } from "react";
import { LifeBuoy, CheckCircle2, UserPlus, UserMinus, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const AGENT_STATUSES = ["NEW", "TRIAGED", "IN_REVIEW", "WAITING_USER", "ESCALATED"] as const;
type AgentStatus = typeof AGENT_STATUSES[number];
type DisplayStatus = AgentStatus | "CLOSED";

const STATUS_COLORS: Record<DisplayStatus, string> = {
  NEW:           "bg-blue-100 text-blue-700",
  TRIAGED:       "bg-indigo-100 text-indigo-700",
  IN_REVIEW:     "bg-amber-100 text-amber-700",
  WAITING_USER:  "bg-purple-100 text-purple-700",
  ESCALATED:     "bg-red-100 text-red-700",
  CLOSED:        "bg-gray-100 text-gray-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW:    "bg-gray-100 text-gray-600",
  NORMAL: "bg-slate-100 text-slate-700",
  HIGH:   "bg-orange-100 text-orange-700",
  URGENT: "bg-red-100 text-red-700",
};

export interface TicketHeaderTicket {
  id: string;
  externalTicketId: string;
  source: string;
  subject: string;
  status: DisplayStatus;
  priority: string;
  category: string;
  orderId: string | null;
  assigneeId: string | null;
  sourceUserName: string;
  sourceUserEmail: string;
  openedAt: string;
  lastUserActivityAt: string;
}

interface Props {
  ticket: TicketHeaderTicket;
  currentUserId: string;
  onMutated: () => void;
}

export function TicketHeader({ ticket, currentUserId, onMutated }: Props) {
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const closed = ticket.status === "CLOSED";

  async function call(fn: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onMutated();
    } catch (e: any) {
      setError(e?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function setStatus(next: AgentStatus) {
    if (closed || next === ticket.status) return;
    call(() =>
      api.patch(`/api/v1/support-tickets/${encodeURIComponent(ticket.id)}/status`, { status: next }),
    );
  }

  function assignToMe() {
    call(() =>
      api.post(`/api/v1/support-tickets/${encodeURIComponent(ticket.id)}/assign`, {
        assigneeId: currentUserId,
      }),
    );
  }

  function unassign() {
    call(() =>
      api.post(`/api/v1/support-tickets/${encodeURIComponent(ticket.id)}/assign`, {
        assigneeId: null,
      }),
    );
  }

  const assignedToMe = ticket.assigneeId === currentUserId;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <LifeBuoy className="h-4 w-4 text-primary" />
            <span className="font-mono text-muted-foreground">{ticket.externalTicketId}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{ticket.source}</span>
          </div>
          <h1 className="text-lg font-semibold">{ticket.subject}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_COLORS[ticket.status])}>
              {ticket.status.replace(/_/g, " ")}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", PRIORITY_COLORS[ticket.priority] ?? "bg-muted text-muted-foreground")}>
              {ticket.priority}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {ticket.category.replace(/_/g, " ")}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{ticket.sourceUserName}</span>
            {" · "}
            {ticket.sourceUserEmail}
            {ticket.orderId && <> · order <span className="font-mono">{ticket.orderId}</span></>}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Status picker */}
          <div className="flex flex-col items-end gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</label>
            <select
              value={closed ? "CLOSED" : ticket.status}
              disabled={busy || closed}
              onChange={(e) => setStatus(e.target.value as AgentStatus)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none disabled:opacity-60"
              title={closed ? "Closed tickets cannot change status" : undefined}
            >
              {AGENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
              {closed && <option value="CLOSED">CLOSED</option>}
            </select>
          </div>

          {/* Assignment */}
          <div className="flex items-center gap-1.5">
            {assignedToMe ? (
              <button
                onClick={unassign}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                <UserMinus className="h-3.5 w-3.5" />
                Unassign me
              </button>
            ) : (
              <button
                onClick={assignToMe}
                disabled={busy || closed}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Assign to me
              </button>
            )}
            {!closed && (
              <button
                onClick={() => setResolveOpen(true)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Resolve
              </button>
            )}
          </div>

          {ticket.assigneeId && !assignedToMe && (
            <div className="text-[10px] text-muted-foreground">
              Assigned to <span className="font-mono">{ticket.assigneeId.slice(0, 8)}</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {resolveOpen && (
        <ResolveModal
          ticketId={ticket.id}
          onClose={() => setResolveOpen(false)}
          onResolved={() => {
            setResolveOpen(false);
            onMutated();
          }}
        />
      )}
    </div>
  );
}

// Inline modal keeps resolve close to the button visually. A shared Dialog
// component exists in the codebase (`components/ui/*`) but this page only
// needs one small modal; avoiding the extra import.
function ResolveModal({
  ticketId,
  onClose,
  onResolved,
}: {
  ticketId: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = note.trim() ? { note: note.trim() } : {};
      const res = await api.post(
        `/api/v1/support-tickets/${encodeURIComponent(ticketId)}/resolve`,
        payload,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onResolved();
    } catch (e: any) {
      setError(e?.message ?? "Failed to resolve");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Resolve ticket</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">
          Closes the ticket on the customer&apos;s side. Optionally, include a
          final public message.
        </p>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Final note to the customer (optional)…"
          className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
        />

        {error && (
          <div className="mt-2 text-[11px] text-red-600">{error}</div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {busy ? "Resolving…" : "Resolve ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
