"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { Command } from "cmdk";
import { Loader2, Sparkles } from "lucide-react";
import { useCommandBarStore } from "@/stores/command-bar-store";
import { CommandResult } from "./command-result";
import { api } from "@/lib/api";

interface StreamChunk {
  type: "thinking" | "result" | "action" | "error";
  content: string;
  data?: Record<string, unknown>;
}

const SUGGESTIONS = [
  "Show me deals losing momentum this week",
  "Create a follow-up task for Acme stakeholders",
  "Which accounts are at risk?",
  "Log that Acme legal is concerned about data residency",
];

export function CommandBar() {
  const { isOpen, close } = useCommandBarStore();
  const [query, setQuery] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chunks, setChunks] = useState<StreamChunk[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        useCommandBarStore.getState().toggle();
      }
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setChunks([]);
    }
  }, [isOpen]);

  // Accept optional override so suggestions can submit immediately
  const handleSubmit = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    if (!q || streaming) return;

    setStreaming(true);
    setChunks([]);

    try {
      // Use api.post so the Authorization header is injected automatically
      const response = await api.post("/api/v1/ai/nl", { command: q });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n").filter(Boolean);

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk: StreamChunk = JSON.parse(line.slice(6));
              setChunks((prev) => [...prev, chunk]);
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }
    } catch {
      setChunks([{ type: "error", content: "Failed to process command. Please try again." }]);
    } finally {
      setStreaming(false);
    }
  }, [query, streaming]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={close}
      />

      {/* Dialog */}
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-2xl -translate-x-1/2 px-4">
        <Command className="overflow-hidden rounded-xl border bg-popover shadow-2xl">
          {/* Input */}
          <div className="flex items-center border-b px-4 py-3">
            {streaming ? (
              <Loader2 className="mr-3 h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : (
              <Sparkles className="mr-3 h-4 w-4 shrink-0 text-primary" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder='Try "show deals losing momentum" or "log that Acme legal is involved"'
            />
            {query && (
              <kbd className="ml-2 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                ↵
              </kbd>
            )}
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto p-2">
            {chunks.length === 0 && !streaming && (
              <div className="space-y-1 p-2">
                <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => { setQuery(suggestion); handleSubmit(suggestion); }}
                    className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {chunks.map((chunk, i) => (
              <CommandResult key={i} chunk={chunk} />
            ))}

            {streaming && chunks.length === 0 && (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            )}
          </div>
        </Command>
      </div>
    </>
  );
}
