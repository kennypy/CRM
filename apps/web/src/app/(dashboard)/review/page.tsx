"use client";

import { useEffect, useState, useCallback } from "react";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  AlertCircle, CheckCircle2, XCircle, RefreshCw,
  ShieldCheck, Brain, ChevronDown, ChevronUp, Inbox,
} from "lucide-react";

type ReviewStatus = "pending" | "approved" | "rejected";

interface ReviewItem {
  id: string;
  entityType: string;
  entityId?: string;
  field: string;
  proposedValue: string;
  currentValue?: string;
  confidence: number;
  matchType?: string;
  evidenceText?: string;
  sourceType: string;
  sourceId?: string;
  status: ReviewStatus;
  createdAt: string;
  _decideError?: boolean;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? "bg-green-500" : pct >= 75 ? "bg-yellow-500" : "bg-orange-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function ReviewCard({ item, onDecide }: {
  item: ReviewItem;
  onDecide: (id: string, decision: "approved" | "rejected") => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy]         = useState(false);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    try { await onDecide(item.id, decision); }
    finally { setBusy(false); }
  };

  return (
    <div className={cn("rounded-lg border bg-card shadow-sm transition-opacity", item.status !== "pending" && "opacity-60")}>
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 rounded-full bg-primary/10 p-1.5">
          <Brain className="h-4 w-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            <span className="text-muted-foreground font-normal">{item.entityType} · </span>
            {item.field}
          </p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {item.currentValue && (
              <>
                <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-600 line-through">{item.currentValue}</span>
                <span className="text-xs text-muted-foreground">→</span>
              </>
            )}
            <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{item.proposedValue}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ConfidenceBar value={item.confidence} />
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground capitalize">{item.sourceType}</span>
            {item.matchType && <span className="text-xs text-muted-foreground">{item.matchType}</span>}
            <span className="text-xs text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
          </div>
          {item._decideError && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Failed to save — please try again
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {item.status === "pending" ? (
            <div className="flex gap-2">
              <button onClick={() => decide("rejected")} disabled={busy}
                className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">
                <XCircle className="h-3.5 w-3.5" /> Reject
              </button>
              <button onClick={() => decide("approved")} disabled={busy}
                className="flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
                <CheckCircle2 className="h-3.5 w-3.5" /> Accept
              </button>
            </div>
          ) : (
            <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
              item.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
              {item.status === "approved"
                ? <><CheckCircle2 className="h-3 w-3" /> Accepted</>
                : <><XCircle className="h-3 w-3" /> Rejected</>}
            </span>
          )}
        </div>
      </div>

      {item.evidenceText && (
        <>
          <div className="border-t px-4 py-2">
            <button onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide" : "Show"} evidence
            </button>
          </div>
          {expanded && (
            <div className="border-t bg-muted/30 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Source excerpt</p>
              <blockquote className="border-l-2 border-primary/40 pl-3 text-xs text-foreground italic leading-relaxed">
                {item.evidenceText}
              </blockquote>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Filter = "all" | "pending" | "approved" | "rejected";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "pending",  label: "Pending"  },
  { key: "approved", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "all",      label: "All"      },
];

export default function ReviewQueuePage() {
  const [items, setItems]     = useState<ReviewItem[]>([]);
  const [filter, setFilter]   = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("status", filter);
      const res = await api.get(`/api/v1/ai/review-queue?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setItems(json.data ?? []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDecide = useCallback(async (id: string, decision: "approved" | "rejected") => {
    // Optimistic update — clear any previous error flag
    setItems((prev) =>
      prev.map((item) => item.id === id ? { ...item, status: decision, _decideError: false } : item)
    );
    try {
      // Backend expects { status } not { decision }
      const res = await api.patch(`/api/v1/ai/review-queue/${id}`, { status: decision });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Revert and surface inline error on the card
      setItems((prev) =>
        prev.map((item) => item.id === id ? { ...item, status: "pending", _decideError: true } : item)
      );
    }
  }, []);

  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">AI Review Queue</h1>
          {pendingCount > 0 && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
              {pendingCount} pending
            </span>
          )}
        </div>
        <button onClick={fetchItems} disabled={loading}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          These are AI-extracted insights with <strong>75–90% confidence</strong>. Review
          each proposed change and accept or reject. Accepted changes are written to the
          graph immediately and help train future extractions.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {FILTERS.map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              filter === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg border bg-card p-4">
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/3 rounded bg-muted" />
                    <div className="h-3 w-1/2 rounded bg-muted" />
                    <div className="h-2 w-1/4 rounded bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {filter === "pending" ? "No pending items — you're all caught up!" : "No items in this view"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <ReviewCard key={item.id} item={item} onDecide={handleDecide} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
