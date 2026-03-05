"use client";

import { useEffect, useState, useCallback } from "react";
import { Mail, Inbox, RefreshCw, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";

interface Thread {
  id:             string;
  subject:        string;
  snippet:        string | null;
  last_message_at: string;
  message_count:  number;
  unread_count:   number;
  participants:   { email: string; name?: string }[];
  status:         string;
}

interface InboxViewProps {
  contactId?: string;
  dealId?:    string;
  onSelectThread: (threadId: string) => void;
  onCompose:      () => void;
}

export function InboxView({ contactId, dealId, onSelectThread, onCompose }: InboxViewProps) {
  const [threads, setThreads]   = useState<Thread[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (contactId) params.set("contactId", contactId);
      if (dealId)    params.set("dealId",    dealId);
      const res  = await api.get(`/api/v1/outreach/email/threads?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to load threads");
      setThreads(json.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [contactId, dealId]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Inbox className="h-3.5 w-3.5" />
          {!loading && <span>{threads.length} thread{threads.length !== 1 ? "s" : ""}</span>}
        </div>
        <button
          onClick={fetchThreads}
          disabled={loading}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse border-b border-border px-4 py-3">
              <div className="mb-1.5 h-3.5 w-2/3 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted/60" />
            </div>
          ))
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Mail className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No emails yet</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                {contactId ? "No email threads with this contact." : "Your inbox is empty."}
              </p>
            </div>
            <button
              onClick={onCompose}
              className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Compose
            </button>
          </div>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className="flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className={cn("flex-1 truncate text-sm", thread.unread_count > 0 ? "font-semibold text-foreground" : "text-foreground/80")}>
                  {thread.subject || "(no subject)"}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {thread.unread_count > 0 && (
                    <span className="h-2 w-2 rounded-full bg-primary" />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(thread.last_message_at)}
                  </span>
                </div>
              </div>
              {thread.snippet && (
                <p className="truncate text-xs text-muted-foreground">{thread.snippet}</p>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {thread.participants.map((p) => p.name || p.email).join(", ")}
                </span>
                {thread.message_count > 1 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {thread.message_count}
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
