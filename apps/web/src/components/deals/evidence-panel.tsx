"use client";

/**
 * EvidencePanel
 *
 * Slides in from the right when a deal's Reality Score badge is clicked.
 * Fetches a fresh score computation from GET /api/v1/deals/:id/reality-score,
 * which triggers: compute → snapshot write → Deal node update → return evidence.
 *
 * Shows:
 *   - Overall score (colour-coded) + trend delta
 *   - Archetype label (Simple / Complex)
 *   - Four pillar bars with evidence lists
 *   - Declared vs Reality comparison + gap
 */

import { useEffect, useState, useCallback } from "react";
import { X, TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

// ── Types (mirrors ScoreResult from reality-score.ts) ─────────────────────────

interface PillarResult {
  score:    number;
  evidence: string[];
}

interface ScoreData {
  score:     number;
  archetype: "simple" | "complex";
  pillars: {
    momentum:     PillarResult;
    commercial:   PillarResult;
    buying_group: PillarResult;
    structural:   PillarResult;
  };
  weights: {
    momentum: number; commercial: number;
    buying_group: number; structural: number;
  };
  trend:       "up" | "down" | "flat";
  trendDelta:  number;
  explanation: string;
  computedAt:  string;
}

interface EvidencePanelProps {
  dealId:             string;
  dealName:           string;
  dealValue:          number;
  declaredProbability?: number;
  onClose:            () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  return s >= 70 ? "text-green-700"  : s >= 40 ? "text-yellow-700"  : "text-red-700";
}
function scoreBg(s: number) {
  return s >= 70 ? "bg-green-100"    : s >= 40 ? "bg-yellow-100"    : "bg-red-100";
}
function barColor(s: number) {
  return s >= 70 ? "bg-green-500"    : s >= 40 ? "bg-yellow-500"    : "bg-red-500";
}

function PillarBar({
  label, score, weight, evidence,
}: {
  label: string; score: number; weight: number; evidence: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{label}</span>
          <span className="text-xs text-muted-foreground">({Math.round(weight * 100)}%)</span>
        </div>
        <span className={cn("text-sm font-bold tabular-nums", scoreColor(score))}>
          {score}
        </span>
      </button>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
        <div
          className={cn("h-1.5 rounded-full transition-all", barColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* Evidence — collapsible */}
      {open && evidence.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {evidence.map((e, i) => (
            <li key={i} className="flex gap-1">
              <span className="mt-0.5 shrink-0 text-border">›</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EvidencePanel({
  dealId, dealName, dealValue, declaredProbability, onClose,
}: EvidencePanelProps) {
  const [data,    setData]    = useState<ScoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // graph-core score endpoint: compute + snapshot + update node
      const res  = await api.get(`/api/v1/deals/${dealId}/reality-score`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      setData(json.data as ScoreData);
    } catch (e: any) {
      setError(e.message ?? "Failed to load score");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const score = data?.score ?? 0;
  const delta = declaredProbability != null && data
    ? data.score - declaredProbability
    : null;

  const pillarConfig = data
    ? [
        { key: "momentum",     label: "Momentum",          ...data.pillars.momentum,     weight: data.weights.momentum },
        { key: "commercial",   label: "Commercial Intent",  ...data.pillars.commercial,   weight: data.weights.commercial },
        { key: "buying_group", label: "Buying Group",       ...data.pillars.buying_group, weight: data.weights.buying_group },
        { key: "structural",   label: "Structural Context", ...data.pillars.structural,   weight: data.weights.structural },
      ]
    : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col border-l border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-xs text-muted-foreground">Reality Score</p>
            <p className="text-sm font-semibold leading-tight line-clamp-1">{dealName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetch_}
              disabled={loading}
              title="Recompute"
              className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
            <button
              onClick={onClose}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="space-y-3">
              {[80, 60, 70, 55, 65].map((w, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}

          {data && (
            <>
              {/* Score summary */}
              <div className={cn("rounded-xl p-4", scoreBg(score))}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={cn("text-4xl font-bold tabular-nums", scoreColor(score))}>
                      {score}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                      {data.archetype} deal
                    </p>
                  </div>
                  <div className="text-right">
                    {/* Trend */}
                    <div className={cn("flex items-center gap-1 text-sm font-medium", scoreColor(score))}>
                      {data.trend === "up"   && <TrendingUp   className="h-4 w-4" />}
                      {data.trend === "down" && <TrendingDown className="h-4 w-4" />}
                      {data.trend === "flat" && <Minus        className="h-4 w-4" />}
                      {data.trendDelta !== 0
                        ? `${data.trendDelta > 0 ? "+" : ""}${data.trendDelta} vs 7d ago`
                        : "Flat vs 7d ago"}
                    </div>

                    {/* Declared vs Reality */}
                    {declaredProbability != null && (
                      <div className="mt-2 text-xs">
                        <span className="text-muted-foreground">Declared: </span>
                        <span className="font-medium">{declaredProbability}%</span>
                        {delta != null && (
                          <span className={cn(
                            "ml-1.5 font-semibold",
                            delta < -15 ? "text-red-600" : delta < 0 ? "text-yellow-600" : "text-green-600"
                          )}>
                            ({delta > 0 ? "+" : ""}{delta})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">{data.explanation}</p>
              </div>

              {/* Declared → Reality comparison bar */}
              {declaredProbability != null && (
                <div className="rounded-lg border border-border p-3 text-xs">
                  <p className="mb-2 font-medium text-foreground">Forecast impact</p>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Rep's call: <strong className="text-foreground">${Math.round(dealValue * declaredProbability / 100).toLocaleString()}</strong></span>
                    <span>Reality: <strong className={scoreColor(score)}>${Math.round(dealValue * score / 100).toLocaleString()}</strong></span>
                  </div>
                  {delta != null && Math.abs(delta) > 10 && (
                    <p className="mt-1.5 text-red-600">
                      <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                      ${Math.abs(Math.round(dealValue * delta / 100)).toLocaleString()} forecast gap
                    </p>
                  )}
                </div>
              )}

              {/* Pillar breakdown */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Score Breakdown — click to expand evidence
                </p>
                <div className="space-y-2">
                  {pillarConfig.map((p) => (
                    <PillarBar
                      key={p.key}
                      label={p.label}
                      score={p.score}
                      weight={p.weight}
                      evidence={p.evidence}
                    />
                  ))}
                </div>
              </div>

              <p className="text-center text-[10px] text-muted-foreground">
                Computed {new Date(data.computedAt).toLocaleTimeString()}
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
