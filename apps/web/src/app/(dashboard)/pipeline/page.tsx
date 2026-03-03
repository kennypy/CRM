"use client";

/**
 * Pipeline Kanban Board
 *
 * Groups deals by stage and lets reps drag (or click) cards between columns.
 * Reality Score is shown as a colour-coded badge on every deal card.
 * Data is fetched client-side so the board stays live-refreshable.
 */

import { useEffect, useState, useCallback } from "react";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  Briefcase,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  DollarSign,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type DealStage =
  | "discovery"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

interface Deal {
  id: string;
  name: string;
  value: number;
  stage: DealStage;
  closeDate?: string;
  company?: { id: string; name: string };
  realityScore?: number;
  updatedAt: string;
}

// ── Stage config ──────────────────────────────────────────────────────────────

const STAGES: { key: DealStage; label: string; color: string }[] = [
  { key: "discovery",   label: "Discovery",   color: "border-blue-400" },
  { key: "proposal",    label: "Proposal",    color: "border-yellow-400" },
  { key: "negotiation", label: "Negotiation", color: "border-orange-400" },
  { key: "closed_won",  label: "Closed Won",  color: "border-green-500" },
  { key: "closed_lost", label: "Closed Lost", color: "border-red-400" },
];

const STAGE_ORDER: DealStage[] = [
  "discovery",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];

// ── Reality Score badge ───────────────────────────────────────────────────────

function RealityBadge({ score }: { score?: number }) {
  if (score == null) return null;

  const color =
    score >= 70 ? "bg-green-100 text-green-700" :
    score >= 40 ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700";

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", color)}>
      <TrendingUp className="h-3 w-3" />
      {score}
    </span>
  );
}

// ── Deal card ─────────────────────────────────────────────────────────────────

function DealCard({
  deal,
  onMove,
  isFirst,
  isLast,
}: {
  deal: Deal;
  onMove: (id: string, direction: "prev" | "next") => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const isWon  = deal.stage === "closed_won";
  const isLost = deal.stage === "closed_lost";

  return (
    <div className={cn(
      "rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
      isWon  && "border-green-200 bg-green-50/50",
      isLost && "border-red-200 bg-red-50/50 opacity-70",
    )}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-tight text-foreground line-clamp-2">
          {deal.name}
        </p>
        <RealityBadge score={deal.realityScore} />
      </div>

      {deal.company && (
        <p className="mb-2 text-xs text-muted-foreground">{deal.company.name}</p>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-medium text-foreground">
          <DollarSign className="h-3 w-3" />
          {formatCurrency(deal.value, "USD", true)}
        </span>
        {deal.closeDate && (
          <span>Close {new Date(deal.closeDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        )}
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        Updated {formatRelativeTime(deal.updatedAt)}
      </p>

      {/* Stage move controls */}
      {!isWon && !isLost && (
        <div className="mt-2 flex gap-1">
          {!isFirst && (
            <button
              onClick={() => onMove(deal.id, "prev")}
              className="flex-1 rounded border border-border py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <ChevronLeft className="mx-auto h-3 w-3" />
            </button>
          )}
          {!isLast && (
            <button
              onClick={() => onMove(deal.id, "next")}
              className="flex-1 rounded border border-border py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <ChevronRight className="mx-auto h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Kanban column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  deals,
  onMove,
}: {
  stage: (typeof STAGES)[number];
  deals: Deal[];
  onMove: (id: string, direction: "prev" | "next") => void;
}) {
  const total = deals.reduce((sum, d) => sum + d.value, 0);
  const isFirst = stage.key === STAGE_ORDER[0];
  const isLast  = stage.key === STAGE_ORDER[STAGE_ORDER.length - 1];

  return (
    <div className="flex w-64 shrink-0 flex-col gap-2">
      {/* Column header */}
      <div className={cn("rounded-t-lg border-t-4 bg-muted/50 px-3 py-2", stage.color)}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{stage.label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
            {deals.length}
          </span>
        </div>
        {deals.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatCurrency(total, "USD", true)} total
          </p>
        )}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            onMove={onMove}
            isFirst={isFirst}
            isLast={isLast}
          />
        ))}
        {deals.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No deals
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const [deals, setDeals]     = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/api/v1/deals?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setDeals(json.data ?? []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load deals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  const handleMove = useCallback(async (id: string, direction: "prev" | "next") => {
    const deal = deals.find((d) => d.id === id);
    if (!deal) return;

    const currentIdx = STAGE_ORDER.indexOf(deal.stage);
    const nextIdx    = direction === "next" ? currentIdx + 1 : currentIdx - 1;
    if (nextIdx < 0 || nextIdx >= STAGE_ORDER.length) return;

    const newStage = STAGE_ORDER[nextIdx];

    // Optimistic update
    setDeals((prev) =>
      prev.map((d) => (d.id === id ? { ...d, stage: newStage } : d))
    );

    try {
      await api.patch(`/api/v1/deals/${id}`, { stage: newStage });
    } catch {
      // Revert on failure
      setDeals((prev) =>
        prev.map((d) => (d.id === id ? { ...d, stage: deal.stage } : d))
      );
    }
  }, [deals]);

  // Group deals by stage
  const byStage = STAGE_ORDER.reduce<Record<DealStage, Deal[]>>(
    (acc, s) => ({ ...acc, [s]: [] }),
    {} as Record<DealStage, Deal[]>
  );
  for (const deal of deals) {
    byStage[deal.stage]?.push(deal);
  }

  // Pipeline metrics
  const openDeals  = deals.filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost");
  const totalValue = openDeals.reduce((sum, d) => sum + d.value, 0);
  const wonDeals   = deals.filter((d) => d.stage === "closed_won");
  const wonValue   = wonDeals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Pipeline</h1>
        </div>
        <button
          onClick={fetchDeals}
          disabled={loading}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Open deals",  value: openDeals.length.toString() },
          { label: "Open value",  value: formatCurrency(totalValue, "USD", true) },
          { label: "Closed won",  value: formatCurrency(wonValue, "USD", true) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Board */}
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {STAGES.map((stage) => (
              <KanbanColumn
                key={stage.key}
                stage={stage}
                deals={byStage[stage.key]}
                onMove={handleMove}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
