"use client";

import { useState } from "react";
import { Send, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AttachmentUploader, type Attachment } from "./AttachmentUploader";

interface Props {
  ticketId: string;
  /** Called when a reply was accepted (202). Parent refetches the thread. */
  onSent: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

const MAX_BODY = 5000;

export function ReplyComposer({ ticketId, onSent, disabled, disabledReason }: Props) {
  const [body, setBody]             = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function send() {
    if (!body.trim() || disabled) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.post(`/api/v1/support-tickets/${encodeURIComponent(ticketId)}/reply`, {
        body:           body.trim(),
        attachmentUrls: attachments.map((a) => a.url),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      setBody("");
      setAttachments([]);
      onSent();
    } catch (e: any) {
      setError(e?.message ?? "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  const overLimit = body.length > MAX_BODY;
  const canSend   = !disabled && !sending && body.trim().length > 0 && !overLimit;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Reply to customer</h2>
          <p className="text-[11px] text-muted-foreground">
            Public reply — the customer sees this on Vintage under &ldquo;Suporte Vintage&rdquo;.
          </p>
        </div>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={disabled || sending}
        rows={5}
        maxLength={MAX_BODY + 200 /* allow overtyping so the counter surfaces the error */}
        placeholder={
          disabled
            ? (disabledReason ?? "Replies disabled")
            : "Type your public reply…"
        }
        className={cn(
          "w-full resize-y rounded-md border bg-background p-2 text-sm focus:outline-none",
          overLimit
            ? "border-red-300 focus:border-red-400"
            : "border-border focus:border-primary",
        )}
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <AttachmentUploader
          attachments={attachments}
          onChange={setAttachments}
          disabled={disabled || sending}
        />
        <div className="flex items-center gap-3">
          <span className={cn("text-[11px]", overLimit ? "text-red-600" : "text-muted-foreground")}>
            {body.length}/{MAX_BODY}
          </span>
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending…" : "Send reply"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-600">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}
