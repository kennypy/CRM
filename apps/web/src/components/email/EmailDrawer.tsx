"use client";

import { useState } from "react";
import { X, Mail, Inbox, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { InboxView } from "./InboxView";
import { ThreadView } from "./ThreadView";
import { ComposeView } from "./ComposeView";

export interface EmailDrawerProps {
  contactId?:    string;
  contactEmail?: string;
  contactName?:  string;
  dealId?:       string;
  onClose:       () => void;
}

type EmailView = "inbox" | "thread" | "compose";

export function EmailDrawer({
  contactId, contactEmail, contactName, dealId, onClose,
}: EmailDrawerProps) {
  const [view, setView]         = useState<EmailView>("inbox");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  function openThread(threadId: string) {
    setActiveThreadId(threadId);
    setView("thread");
  }

  function openCompose() {
    setView("compose");
  }

  function backToInbox() {
    setActiveThreadId(null);
    setView("inbox");
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[520px] flex-col border-l border-border bg-background shadow-2xl">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">
            Email
            {contactName && <span className="ml-1 text-muted-foreground font-normal">— {contactName}</span>}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {view !== "compose" && (
            <button
              onClick={openCompose}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              <Pencil className="h-3 w-3" /> Compose
            </button>
          )}
          {view !== "inbox" && (
            <button
              onClick={backToInbox}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              <Inbox className="h-3 w-3" /> Inbox
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {view === "inbox" && (
          <InboxView
            contactId={contactId}
            dealId={dealId}
            onSelectThread={openThread}
            onCompose={openCompose}
          />
        )}
        {view === "thread" && activeThreadId && (
          <ThreadView
            threadId={activeThreadId}
            onReply={() => setView("compose")}
            onBack={backToInbox}
          />
        )}
        {view === "compose" && (
          <ComposeView
            defaultTo={contactEmail ? [contactEmail] : []}
            contactId={contactId}
            contactName={contactName}
            dealId={dealId}
            onSent={backToInbox}
            onCancel={backToInbox}
          />
        )}
      </div>
    </div>
  );
}
