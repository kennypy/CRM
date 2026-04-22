"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { TicketHeader, type TicketHeaderTicket } from "@/components/support/TicketHeader";
import { MessageThread } from "@/components/support/MessageThread";
import type { Message } from "@/components/support/MessageItem";
import type { DeliveryJob } from "@/components/support/DeliveryChip";
import { ReplyComposer } from "@/components/support/ReplyComposer";
import { NoteComposer } from "@/components/support/NoteComposer";

interface TicketDetail extends TicketHeaderTicket {
  messages: Message[];
  jobs:     DeliveryJob[];
}

// Poll the detail endpoint while there are non-terminal delivery jobs so
// agents see the chip transition from Queued → Sending → Delivered without
// manually refreshing. Terminal states (delivered / dead_letter) don't need
// polling.
const POLL_INTERVAL_MS = 3000;

export default function SupportTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [ticket, setTicket]   = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const user = getStoredUser();
  const currentUserId = user?.id ?? "";

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get(`/api/v1/support-tickets/${encodeURIComponent(id)}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Ticket not found");
        throw new Error(`HTTP ${res.status}`);
      }
      setTicket(await res.json());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while an outbound job is still in flight.
  useEffect(() => {
    if (!ticket) return;
    const hasInFlight = ticket.jobs.some(
      (j) => j.status === "pending" || j.status === "in_flight" || j.status === "stuck",
    );
    if (!hasInFlight) return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ticket, load]);

  if (loading && !ticket) {
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
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to inbox
        </Link>
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error ?? "Ticket not available"}
        </div>
      </div>
    );
  }

  const closed = ticket.status === "CLOSED";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to inbox
        </Link>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <TicketHeader
        ticket={ticket}
        currentUserId={currentUserId}
        onMutated={load}
      />

      <MessageThread
        messages={ticket.messages}
        jobs={ticket.jobs}
        onJobRetried={load}
      />

      {closed ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          This ticket is closed. Internal notes are still allowed.
        </div>
      ) : (
        <ReplyComposer ticketId={ticket.id} onSent={load} />
      )}

      <NoteComposer ticketId={ticket.id} onSaved={load} />
    </div>
  );
}
