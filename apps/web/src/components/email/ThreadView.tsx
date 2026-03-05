"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, Reply, AlertCircle, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface EmailMessage {
  id:              string;
  direction:       "inbound" | "outbound";
  from_email:      string;
  from_name:       string | null;
  to_recipients:   { email: string; name?: string }[];
  subject:         string;
  body_text:       string;
  send_status:     string;
  sent_at:         string | null;
  created_at:      string;
}

interface ThreadViewProps {
  threadId:  string;
  onReply:   () => void;
  onBack:    () => void;
}

export function ThreadView({ threadId, onReply, onBack }: ThreadViewProps) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await api.get(`/api/v1/outreach/email/threads/${threadId}/messages`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to load messages");
      setMessages(json.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  if (loading) return (
    <div className="flex h-full flex-col gap-3 p-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-border p-4">
          <div className="mb-2 h-3 w-1/3 rounded bg-muted" />
          <div className="space-y-1.5">
            <div className="h-3 w-full rounded bg-muted/60" />
            <div className="h-3 w-4/5 rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );

  const subject = messages[0]?.subject ?? "(no subject)";

  return (
    <div className="flex h-full flex-col">
      {/* Thread header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button onClick={onBack} className="shrink-0 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className="truncate text-sm font-medium">{subject}</h3>
        </div>
        <button
          onClick={onReply}
          className="ml-2 flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          <Reply className="h-3.5 w-3.5" /> Reply
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "rounded-lg border p-4",
              msg.direction === "outbound"
                ? "border-primary/20 bg-primary/5"
                : "border-border bg-muted/30",
            )}
          >
            {/* Message header */}
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Mail className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs font-medium text-foreground">
                    {msg.from_name || msg.from_email}
                  </span>
                  <span className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
                    msg.direction === "outbound"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}>
                    {msg.direction === "outbound" ? "Sent" : "Received"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  To: {msg.to_recipients.map((r) => r.name || r.email).join(", ")}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {msg.sent_at
                  ? new Date(msg.sent_at).toLocaleString()
                  : new Date(msg.created_at).toLocaleString()}
              </span>
            </div>

            {/* Body */}
            <div className="whitespace-pre-wrap text-sm text-foreground/90">
              {msg.body_text}
            </div>

            {/* Status */}
            {msg.direction === "outbound" && msg.send_status !== "sent" && (
              <div className="mt-2">
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px]",
                  msg.send_status === "failed"  ? "bg-red-100 text-red-700" :
                  msg.send_status === "sending" ? "bg-yellow-100 text-yellow-700" :
                  "bg-muted text-muted-foreground",
                )}>
                  {msg.send_status}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
