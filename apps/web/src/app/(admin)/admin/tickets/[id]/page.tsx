"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import {
  Ticket as TicketIcon, ArrowLeft, AlertCircle,
  MessageSquarePlus, RefreshCw, User as UserIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
type Status   = typeof STATUSES[number];
type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

interface Note {
  id: string;
  content: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
}

interface TicketDetail {
  id: string;
  source: string;
  sourceTicketId: string;
  sourceUserId: string | null;
  externalTicketId: string;
  subject: string;
  body: string;
  category: string;
  priority: Priority;
  orderId: string | null;
  status: Status;
  sourceCreatedAt: string;
  createdAt: string;
  updatedAt: string;
  notes: Note[];
}

const STATUS_COLORS: Record<Status, string> = {
  OPEN:        "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  RESOLVED:    "bg-green-100 text-green-700",
  CLOSED:      "bg-gray-100 text-gray-700",
};

const PRIORITY_COLORS: Record<Priority, string> = {
  LOW:    "bg-gray-100 text-gray-600",
  NORMAL: "bg-slate-100 text-slate-700",
  HIGH:   "bg-orange-100 text-orange-700",
  URGENT: "bg-red-100 text-red-700",
};

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ticket, setTicket]   = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/v1/tickets/${encodeURIComponent(id)}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Ticket not found");
        throw new Error(`HTTP ${res.status}`);
      }
      setTicket(await res.json());
    } catch (e: any) {
      setError(e.message ?? "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (next: Status) => {
    if (!ticket || ticket.status === next) return;
    setSaving(true);
    try {
      const res = await api.patch(`/api/v1/tickets/${encodeURIComponent(ticket.id)}`, { status: next });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      setTicket((t) => t ? { ...t, status: updated.status, updatedAt: updated.updatedAt } : t);
    } catch (e: any) {
      setError(e.message ?? "Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!ticket || !noteContent.trim()) return;
    setSaving(true);
    try {
      const res = await api.post(
        `/api/v1/tickets/${encodeURIComponent(ticket.id)}/notes`,
        { content: noteContent.trim() },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const note = await res.json();
      setTicket((t) => t ? { ...t, notes: [note, ...t.notes] } : t);
      setNoteContent("");
    } catch (e: any) {
      setError(e.message ?? "Failed to add note");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-6 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted/60" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href="/admin/tickets" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to tickets
        </Link>
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error ?? "Not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/admin/tickets" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to tickets
        </Link>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <TicketIcon className="h-4 w-4 text-primary" />
              <span className="font-mono text-muted-foreground">{ticket.externalTicketId}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{ticket.source}</span>
            </div>
            <h1 className="text-lg font-semibold">{ticket.subject}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_COLORS[ticket.status])}>
                {ticket.status.replace(/_/g, " ")}
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", PRIORITY_COLORS[ticket.priority])}>
                {ticket.priority}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {ticket.category.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</label>
            <select
              value={ticket.status}
              disabled={saving}
              onChange={(e) => updateStatus(e.target.value as Status)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Source metadata */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Source metadata
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
          <Field label="Source ticket ID"><span className="font-mono text-xs">{ticket.sourceTicketId}</span></Field>
          <Field label="Source user ID"><span className="font-mono text-xs">{ticket.sourceUserId ?? "—"}</span></Field>
          <Field label="Order ID"><span className="font-mono text-xs">{ticket.orderId ?? "—"}</span></Field>
          <Field label="Created on source">{new Date(ticket.sourceCreatedAt).toLocaleString()}</Field>
          <Field label="Received in CRM">{new Date(ticket.createdAt).toLocaleString()}</Field>
          <Field label="Last updated">{new Date(ticket.updatedAt).toLocaleString()}</Field>
        </dl>
      </div>

      {/* Body */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Customer message
        </div>
        <div className="whitespace-pre-wrap p-5 text-sm text-foreground">{ticket.body}</div>
      </div>

      {/* Notes */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Internal notes
        </div>

        <div className="border-b border-border p-5">
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            rows={3}
            maxLength={10_000}
            placeholder="Add an internal note (visible only inside the CRM)…"
            className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Internal notes are not sent back to the customer or to {ticket.source}.
            </span>
            <button
              onClick={addNote}
              disabled={saving || !noteContent.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Add note
            </button>
          </div>
        </div>

        {ticket.notes.length === 0 ? (
          <div className="p-5 text-center text-xs text-muted-foreground">
            No internal notes yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {ticket.notes.map((n) => (
              <li key={n.id} className="p-5 text-sm">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <UserIcon className="h-3 w-3" />
                  <span>{n.authorName ?? "Unknown"}</span>
                  <span>·</span>
                  <span>{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap text-foreground">{n.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
