"use client";

/**
 * ComposeView — dual-window email composer.
 *
 * Left pane:  Rep's editable plain text draft
 * Right pane: AI suggestion (generated on demand, copy-to-draft button)
 *
 * Provider selection: Gmail or Outlook, based on connected accounts.
 */

import { useState, useRef } from "react";
import {
  Send, Wand2, Copy, RefreshCw, AlertCircle, ChevronDown,
  X, Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ComposeViewProps {
  defaultTo?:   string[];
  contactId?:   string;
  contactName?: string;
  dealId?:      string;
  onSent:       () => void;
  onCancel:     () => void;
}

type Provider = "gmail" | "outlook";

interface AISuggestion { subject: string; body: string }

export function ComposeView({
  defaultTo = [], contactId, contactName, dealId, onSent, onCancel,
}: ComposeViewProps) {
  const [to,       setTo]       = useState<string[]>(defaultTo);
  const [toInput,  setToInput]  = useState("");
  const [subject,  setSubject]  = useState("");
  const [body,     setBody]     = useState("");
  const [provider, setProvider] = useState<Provider>("gmail");
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // AI suggestion state
  const [suggestion,    setSuggestion]    = useState<AISuggestion | null>(null);
  const [aiLoading,     setAiLoading]     = useState(false);
  const [aiError,       setAiError]       = useState<string | null>(null);
  const [showAiPane,    setShowAiPane]    = useState(true);

  function addRecipient() {
    const email = toInput.trim().toLowerCase();
    if (email && email.includes("@") && !to.includes(email)) {
      setTo([...to, email]);
    }
    setToInput("");
  }

  async function requestSuggestion() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res  = await api.post("/api/v1/outreach/email/suggest", {
        email:         to[0] ?? "",
        existingSubject: subject || undefined,
        existingBody:    body || undefined,
        step:          1,
        sequenceName:  "Email",
        ...(contactName ? { firstName: contactName.split(" ")[0], lastName: contactName.split(" ").slice(1).join(" ") } : {}),
      });
      const json = await res.json();
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "AI suggestion unavailable");
      setSuggestion(json.data);
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  }

  function acceptSuggestion() {
    if (!suggestion) return;
    setSubject(suggestion.subject);
    setBody(suggestion.body);
  }

  function acceptSubjectOnly() {
    if (!suggestion) return;
    setSubject(suggestion.subject);
  }

  function acceptBodyOnly() {
    if (!suggestion) return;
    setBody(suggestion.body);
  }

  async function handleSend() {
    if (!to.length || !subject.trim() || !body.trim()) {
      setError("To, subject, and body are required.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res  = await api.post("/api/v1/outreach/email/send", {
        to, subject, bodyText: body, provider, contactId, dealId,
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error?.message ?? "Send failed";
        if (json.error?.code === "OPT_OUT") throw new Error(msg);
        if (json.error?.code === "PLAN_LIMIT") throw new Error(msg);
        throw new Error(msg);
      }
      onSent();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Fields bar */}
      <div className="space-y-0 border-b border-border">
        {/* To field */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground w-10">To</span>
          {to.map((e) => (
            <span key={e} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {e}
              <button onClick={() => setTo(to.filter((x) => x !== e))} className="ml-0.5">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            type="email"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addRecipient(); } }}
            onBlur={addRecipient}
            placeholder={to.length === 0 ? "recipient@example.com" : "Add more…"}
            className="flex-1 min-w-[120px] bg-transparent text-sm focus:outline-none"
          />
        </div>

        {/* Subject */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground w-10">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line"
            maxLength={998}
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
        </div>

        {/* Provider + AI toggle */}
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Send via</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook</option>
            </select>
          </div>
          <button
            onClick={() => setShowAiPane((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs",
              showAiPane ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Wand2 className="h-3 w-3" />
            AI Assist {showAiPane ? "on" : "off"}
          </button>
        </div>
      </div>

      {/* Dual-pane body */}
      <div className={cn("flex flex-1 overflow-hidden", showAiPane ? "gap-0" : "")}>
        {/* Left: editable draft */}
        <div className={cn("flex flex-col", showAiPane ? "w-1/2 border-r border-border" : "flex-1")}>
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your Draft</span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your email…"
            className="flex-1 resize-none bg-transparent p-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        {/* Right: AI suggestion */}
        {showAiPane && (
          <div className="flex w-1/2 flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">AI Suggestion</span>
              <button
                onClick={requestSuggestion}
                disabled={aiLoading || !to.length}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                <RefreshCw className={cn("h-3 w-3", aiLoading && "animate-spin")} />
                {suggestion ? "Regenerate" : "Generate"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {!suggestion && !aiLoading && !aiError && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <Wand2 className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">
                    Click Generate to get an AI-written suggestion based on contact history
                  </p>
                  <button
                    onClick={requestSuggestion}
                    disabled={!to.length}
                    className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                  >
                    Generate suggestion
                  </button>
                </div>
              )}

              {aiLoading && (
                <div className="flex h-full items-center justify-center">
                  <div className="space-y-2 w-full animate-pulse">
                    <div className="h-3 w-2/3 rounded bg-muted" />
                    <div className="h-3 w-full rounded bg-muted/70" />
                    <div className="h-3 w-5/6 rounded bg-muted/70" />
                    <div className="h-3 w-3/4 rounded bg-muted/50" />
                  </div>
                </div>
              )}

              {aiError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {aiError}
                </div>
              )}

              {suggestion && !aiLoading && (
                <div className="space-y-3">
                  {/* Subject suggestion */}
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-medium uppercase text-muted-foreground">Subject</span>
                      <button
                        onClick={acceptSubjectOnly}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <Copy className="h-2.5 w-2.5" /> Use
                      </button>
                    </div>
                    <p className="text-xs text-foreground">{suggestion.subject}</p>
                  </div>

                  {/* Body suggestion */}
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-medium uppercase text-muted-foreground">Body</span>
                      <button
                        onClick={acceptBodyOnly}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <Copy className="h-2.5 w-2.5" /> Use
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap text-xs text-foreground">{suggestion.body}</p>
                  </div>

                  {/* Accept all */}
                  <button
                    onClick={acceptSuggestion}
                    className="w-full rounded-md border border-primary px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5"
                  >
                    Use entire suggestion
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        {error ? (
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {body.length > 0 ? `${body.length} chars` : ""}
          </span>
        )}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !to.length || !subject.trim() || !body.trim()}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
