"use client";

/**
 * Pipeline — Kanban + Forecast Clarity
 *
 * Currency: always uses tenant.defaultCurrency from TenantContext.
 * Gap threshold: GAP_THRESHOLD_PCT % of declared forecast (currency-agnostic).
 */

import { useEffect, useState, useCallback } from "react";
import { formatCurrency, formatRelativeTime, cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";
import { api } from "@/lib/api";
import { EvidencePanel } from "@/components/deals/evidence-panel";
import { DealDetailPanel } from "@/components/deals/deal-detail-panel";
import { AddDealModal } from "@/components/modals/add-deal-modal";
import {
  Briefcase, RefreshCw, TrendingUp, AlertCircle, Plus,
  ChevronRight, ChevronLeft, DollarSign, AlertTriangle,
} from "lucide-react";

type DealStage =
  | "discovery" | "proposal" | "negotiation"
  | "closed_won" | "closed_lost";

interface Deal {
  id:                   string;
  name:                 string;
  value:                number;
  /** ISO 4217 deal-level currency (falls back to tenant.defaultCurrency). */
  currency?:            string;
  stage:                DealStage;
  closeDate?:           string;
  company?:             { id: string; name: string };
  archetype?:           "simple" | "complex";
  realityScore?:        number;
  declaredProbability?: number;
  updatedAt:            string;
}

const STAGES: { key: DealStage; label: string; color: string }[] = [
  { key: "discovery",   label: "Discovery",   color: "border-blue-400" },
  { key: "proposal",    label: "Proposal",    color: "border-yellow-400" },
  { key: "negotiation", label: "Negotiation", color: "border-orange-400" },
  { key: "closed_won",  label: "Closed Won",  color: "border-green-500" },
  { key: "closed_lost", label: "Closed Lost", color: "border-red-400" },
];

const STAGE_ORDER: DealStage[] = [
  "discovery", "proposal", "negotiation", "closed_won", "closed_lost",
];

// Gap is significant when it exceeds this % of the declared forecast.
// Currency-agnostic: 15 % of €50 k = €7.5 k; same rule for any currency.
const GAP_THRESHOLD_PCT = 15;

function RealityBadge({ score, onClick }: { score?: number; onClick?: () => void }) {
  if (score == null) return null;
  const color =
    score >= 70 ? "bg-green-100 text-green-700 hover:bg-green-200" :
    score >= 40 ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200" :
                  "bg-red-100 text-red-700 hover:bg-red-200";
  return (
    <button
      onClick={onClick}
      title="Click to see score evidence"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
        color, onClick && "cursor-pointer"
      )}
    >
      <TrendingUp className="h-3 w-3" />
      {score}
    </button>
  );
}

function DeltaBadge({ declared, reality }: { declared?: number; reality?: number }) {
  if (declared == null || reality == null) return null;
  const delta = reality - declared;
  const label = `${delta > 0 ? "+" : ""}${delta}`;
  const color =
    delta < -20 ? "text-red-600 font-bold" :
    delta < -10 ? "text-yellow-600 font-semibold" :
    delta >= 0  ? "text-green-600" : "text-muted-foreground";
  return (
    <span className={cn("tabular-nums text-xs", color)} title={`Declared ${declared}% vs Reality ${reality}%`}>
      {delta < -20 && <AlertTriangle className="inline h-3 w-3 mr-0.5" />}
      {label}
    </span>
  );
}

function DealCard({
  deal, currency, locale, onMove, isFirst, isLast, onScoreClick, onDeclaredChange, onDetailClick,
}: {
  deal: Deal; currency: string; locale: string;
  onMove: (id: string, direction: "prev" | "next") => void;
  isFirst: boolean; isLast: boolean;
  onScoreClick: (deal: Deal) => void;
  onDeclaredChange: (id: string, pct: number) => void;
  onDetailClick: (deal: Deal) => void;
}) {
  const isWon  = deal.stage === "closed_won";
  const isLost = deal.stage === "closed_lost";
  const [editingProb, setEditingProb] = useState(false);
  const [probInput,   setProbInput]   = useState(String(deal.declaredProbability ?? ""));
  const dealCurrency = deal.currency ?? currency;

  const commitProb = () => {
    const v = parseInt(probInput, 10);
    if (!isNaN(v) && v >= 0 && v <= 100) onDeclaredChange(deal.id, v);
    setEditingProb(false);
  };

  return (
    <div className={cn(
      "rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
      isWon  && "border-green-200 bg-green-50/50",
      isLost && "border-red-200 bg-red-50/50 opacity-70",
    )}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <button
          onClick={() => onDetailClick(deal)}
          className="text-left text-sm font-semibold leading-tight text-foreground line-clamp-2 hover:text-primary transition-colors"
          title="Click to view deal details"
        >
          {deal.name}
        </button>
        <RealityBadge score={deal.realityScore} onClick={() => onScoreClick(deal)} />
      </div>

      {deal.company && (
        <button
          onClick={() => onDetailClick(deal)}
          className="mb-2 block text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {deal.company.name}
        </button>
      )}

      <div className="flex items-center gap-1 text-xs font-medium text-foreground">
        <DollarSign className="h-3 w-3" />
        {formatCurrency(deal.value, dealCurrency, true, locale)}
        {deal.closeDate && (
          <span className="ml-auto text-muted-foreground">
            {new Date(deal.closeDate).toLocaleDateString(locale, { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      {!isWon && !isLost && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground shrink-0">Rep:</span>
          {editingProb ? (
            <input
              autoFocus type="number" min={0} max={100}
              value={probInput}
              onChange={(e) => setProbInput(e.target.value)}
              onBlur={commitProb}
              onKeyDown={(e) => { if (e.key === "Enter") commitProb(); if (e.key === "Escape") setEditingProb(false); }}
              className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center tabular-nums outline-none focus:border-primary"
            />
          ) : (
            <button onClick={() => setEditingProb(true)} className="tabular-nums hover:underline" title="Click to edit declared probability">
              {deal.declaredProbability != null ? `${deal.declaredProbability}%` : "—"}
            </button>
          )}
          {deal.realityScore != null && (
            <>
              <span className="text-muted-foreground">Reality: {deal.realityScore}%</span>
              <DeltaBadge declared={deal.declaredProbability} reality={deal.realityScore} />
            </>
          )}
        </div>
      )}

      <p className="mt-1.5 text-xs text-muted-foreground">
        Updated {formatRelativeTime(deal.updatedAt, locale)}
      </p>

      {!isWon && !isLost && (
        <div className="mt-2 flex gap-1">
          {!isFirst && (
            <button onClick={() => onMove(deal.id, "prev")}
              className="flex-1 rounded border border-border py-0.5 text-xs text-muted-foreground hover:bg-muted">
              <ChevronLeft className="mx-auto h-3 w-3" />
            </button>
          )}
          {!isLast && (
            <button onClick={() => onMove(deal.id, "next")}
              className="flex-1 rounded border border-border py-0.5 text-xs text-muted-foreground hover:bg-muted">
              <ChevronRight className="mx-auto h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  stage, deals, currency, locale, onMove, onScoreClick, onDeclaredChange, onDetailClick,
}: {
  stage: (typeof STAGES)[number]; deals: Deal[]; currency: string; locale: string;
  onMove: (id: string, direction: "prev" | "next") => void;
  onScoreClick: (deal: Deal) => void;
  onDeclaredChange: (id: string, pct: number) => void;
  onDetailClick: (deal: Deal) => void;
}) {
  const total   = deals.reduce((s, d) => s + d.value, 0);
  const isFirst = stage.key === STAGE_ORDER[0];
  const isLast  = stage.key === STAGE_ORDER[STAGE_ORDER.length - 1];

  return (
    <div className="flex w-64 shrink-0 flex-col gap-2">
      <div className={cn("rounded-t-lg border-t-4 bg-muted/50 px-3 py-2", stage.color)}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{stage.label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{deals.length}</span>
        </div>
        {deals.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatCurrency(total, currency, true, locale)} total
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {deals.map((deal) => (
          <DealCard
            key={deal.id} deal={deal} currency={currency} locale={locale}
            onMove={onMove} isFirst={isFirst} isLast={isLast}
            onScoreClick={onScoreClick} onDeclaredChange={onDeclaredChange}
            onDetailClick={onDetailClick}
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

function ForecastBar({ deals, currency, locale }: { deals: Deal[]; currency: string; locale: string }) {
  const open = deals.filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost");
  const declared = open.reduce((s, d) => s + d.value * ((d.declaredProbability ?? 50) / 100), 0);
  const reality  = open.reduce((s, d) => s + d.value * ((d.realityScore     ?? 50) / 100), 0);
  const gap      = declared - reality;
  // Significant gap = >GAP_THRESHOLD_PCT % of declared forecast (currency-agnostic)
  const gapIsSignificant = declared > 0 && (gap / declared) * 100 > GAP_THRESHOLD_PCT;

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-lg border bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">Open pipeline</p>
        <p className="mt-0.5 text-lg font-semibold">
          {formatCurrency(open.reduce((s, d) => s + d.value, 0), currency, true, locale)}
        </p>
      </div>
      <div className="rounded-lg border bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">Declared forecast</p>
        <p className="mt-0.5 text-lg font-semibold">{formatCurrency(declared, currency, true, locale)}</p>
      </div>
      <div className={cn("rounded-lg border px-4 py-3", gapIsSignificant ? "border-red-200 bg-red-50" : "bg-card")}>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Reality forecast</p>
          {gapIsSignificant && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
        </div>
        <p className={cn("mt-0.5 text-lg font-semibold", gapIsSignificant ? "text-red-700" : "text-foreground")}>
          {formatCurrency(reality, currency, true, locale)}
        </p>
        {gap > 0 && (
          <p className="text-xs text-red-600">−{formatCurrency(gap, currency, true, locale)} vs declared</p>
        )}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const { tenant }  = useTenant();
  const currency    = tenant.defaultCurrency;
  const locale      = tenant.locale;

  const [deals,        setDeals]        = useState<Deal[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [evidenceDeal, setEvidenceDeal] = useState<Deal | null>(null);
  const [detailDeal,   setDetailDeal]   = useState<Deal | null>(null);
  const [showAddDeal,  setShowAddDeal]  = useState(false);

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
    setDeals((prev) => prev.map((d) => d.id === id ? { ...d, stage: newStage } : d));
    try {
      await api.patch(`/api/v1/deals/${id}`, { stage: newStage });
    } catch {
      setDeals((prev) => prev.map((d) => d.id === id ? { ...d, stage: deal.stage } : d));
    }
  }, [deals]);

  const handleDeclaredChange = useCallback(async (id: string, pct: number) => {
    setDeals((prev) => prev.map((d) => d.id === id ? { ...d, declaredProbability: pct } : d));
    try {
      await api.patch(`/api/v1/deals/${id}`, { declaredProbability: pct });
    } catch {
      // Non-critical — optimistic update stays
    }
  }, []);

  const byStage = STAGE_ORDER.reduce<Record<DealStage, Deal[]>>(
    (acc, s) => ({ ...acc, [s]: [] }),
    {} as Record<DealStage, Deal[]>
  );
  for (const deal of deals) { byStage[deal.stage]?.push(deal); }

  const wonValue = deals
    .filter((d) => d.stage === "closed_won")
    .reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Pipeline</h1>
        </div>
        <div className="flex items-center gap-3">
          {wonValue > 0 && (
            <span className="text-sm text-muted-foreground">
              Won: <strong className="text-green-700">{formatCurrency(wonValue, currency, true, locale)}</strong>
            </span>
          )}
          <button onClick={fetchDeals} disabled={loading}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          <button onClick={() => setShowAddDeal(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Add Deal
          </button>
        </div>
      </div>

      {showAddDeal && (
        <AddDealModal
          onClose={() => setShowAddDeal(false)}
          onCreated={() => { setShowAddDeal(false); fetchDeals(); }}
        />
      )}

      <ForecastBar deals={deals} currency={currency} locale={locale} />

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {STAGES.map((stage) => (
              <KanbanColumn
                key={stage.key} stage={stage} deals={byStage[stage.key]}
                currency={currency} locale={locale}
                onMove={handleMove} onScoreClick={setEvidenceDeal}
                onDeclaredChange={handleDeclaredChange}
                onDetailClick={setDetailDeal}
              />
            ))}
          </div>
        </div>
      )}

      {detailDeal && (
        <DealDetailPanel
          dealId={detailDeal.id}
          dealName={detailDeal.name}
          dealValue={detailDeal.value}
          dealCurrency={detailDeal.currency}
          declaredProbability={detailDeal.declaredProbability}
          stage={detailDeal.stage}
          onClose={() => setDetailDeal(null)}
          onScoreClick={() => { setEvidenceDeal(detailDeal); setDetailDeal(null); }}
          onDealUpdated={(patch) =>
            setDeals((prev) => prev.map((d) => d.id === detailDeal.id ? { ...d, ...patch } : d))
          }
        />
      )}

      {evidenceDeal && (
        <EvidencePanel
          dealId={evidenceDeal.id}
          dealName={evidenceDeal.name}
          dealValue={evidenceDeal.value}
          declaredProbability={evidenceDeal.declaredProbability}
          onClose={() => setEvidenceDeal(null)}
        />
      )}
    </div>
  );
}
