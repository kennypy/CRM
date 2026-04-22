"use client";

import { useState } from "react";
import { StickyNote, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  ticketId: string;
  onSaved: () => void;
}

const MAX_CONTENT = 10_000;

/**
 * Internal note composer. Notes live in the CRM only — they are never
 * forwarded to Vintage. Styled distinctly from the reply composer so an
 * agent can't confuse the two mid-flow.
 */
export function NoteComposer({ ticketId, onSaved }: Props) {
  const [content, setContent] = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post(
        `/api/v1/support-tickets/${encodeURIComponent(ticketId)}/notes`,
        { content: content.trim() },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      setContent("");
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  const overLimit = content.length > MAX_CONTENT;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-amber-700" />
        <h2 className="text-sm font-semibold text-amber-900">Internal note</h2>
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 border border-amber-300">
          Not sent to customer
        </span>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder="Context, triage notes, links to related tickets…"
        className="w-full resize-y rounded-md border border-amber-200 bg-white p-2 text-sm focus:border-amber-400 focus:outline-none"
      />

      <div className="mt-2 flex items-center justify-between">
        <span className={`text-[11px] ${overLimit ? "text-red-600" : "text-amber-800/70"}`}>
          {content.length}/{MAX_CONTENT}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saving || !content.trim() || overLimit}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
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
