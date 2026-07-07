"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command } from "cmdk";
import { Loader2, Sparkles, Users, Building2, Briefcase, TrendingUp, CornerDownLeft } from "lucide-react";
import { useCommandBarStore } from "@/stores/command-bar-store";
import { CommandResult } from "./command-result";
import { api } from "@/lib/api";

interface StreamChunk {
  type: "thinking" | "result" | "action" | "error";
  content: string;
  data?: Record<string, unknown>;
}

interface SearchHit {
  type: "contact" | "lead" | "company" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const HIT_ICON = {
  contact: Users,
  lead: TrendingUp,
  company: Building2,
  deal: Briefcase,
} as const;

const HIT_LABEL = {
  contact: "Contact",
  lead: "Lead",
  company: "Company",
  deal: "Deal",
} as const;

const SUGGESTIONS = [
  "Show me deals losing momentum this week",
  "Create a follow-up task for Acme stakeholders",
  "Which accounts are at risk?",
  "Log that Acme legal is concerned about data residency",
];

export function CommandBar() {
  const t = useTranslations("commandBar");
  const router = useRouter();
  const { isOpen, close } = useCommandBarStore();
  const [query, setQuery] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chunks, setChunks] = useState<StreamChunk[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
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
      setHits([]);
    }
  }, [isOpen]);

  // Instant cross-object record search — debounced, runs alongside the AI bar.
  // Records surface immediately as you type; pressing Enter still asks the AI.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); setSearching(false); return; }
    setSearching(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/api/v1/search?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => ({}));
        if (!ctrl.signal.aborted) setHits(data?.data?.results ?? []);
      } catch {
        if (!ctrl.signal.aborted) setHits([]);
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [query]);

  const goTo = useCallback((href: string) => {
    close();
    router.push(href);
  }, [close, router]);

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
      setChunks([{ type: "error", content: t("error") }]);
    } finally {
      setStreaming(false);
    }
  }, [query, streaming, t]);

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
              placeholder={t("placeholder")}
            />
            {query && (
              <kbd className="ml-2 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                ↵
              </kbd>
            )}
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto p-2">
            {/* Instant record matches (jump-to) — shown whenever there's a query
                and the AI stream hasn't taken over the panel. */}
            {chunks.length === 0 && !streaming && query.trim().length >= 2 && (
              <div className="space-y-1 p-1">
                <div className="flex items-center justify-between px-2 py-1">
                  <p className="text-xs font-medium text-muted-foreground">Jump to</p>
                  {searching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
                {hits.length === 0 && !searching ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matching records.</p>
                ) : (
                  hits.map((hit) => {
                    const Icon = HIT_ICON[hit.type];
                    return (
                      <button
                        key={`${hit.type}-${hit.id}`}
                        onClick={() => goTo(hit.href)}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{hit.title}</span>
                          {hit.subtitle && <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>}
                        </span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {HIT_LABEL[hit.type]}
                        </span>
                      </button>
                    );
                  })
                )}
                <div className="mt-1 flex items-center gap-1.5 border-t px-3 pt-2 text-xs text-muted-foreground">
                  <CornerDownLeft className="h-3 w-3" /> Press Enter to ask AI instead
                </div>
              </div>
            )}

            {chunks.length === 0 && !streaming && query.trim().length < 2 && (
              <div className="space-y-1 p-2">
                <p className="text-xs font-medium text-muted-foreground">{t("suggestions")}</p>
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
                {t("thinking")}
              </div>
            )}
          </div>
        </Command>
      </div>
    </>
  );
}
