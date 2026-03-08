"use client";

import { useEffect, useState, useCallback } from "react";
import { formatRelativeTime, formatCurrency, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useTenantContext } from "@/lib/tenant-context";
import {
  LineChart, RefreshCw, AlertCircle, TrendingUp, TrendingDown,
  DollarSign, Target, BarChart3, Zap,
} from "lucide-react";

interface Forecast {
  id: string;
  dealId: string;
  predictedCloseProbability: number;
  predictedCloseDate: string | null;
  predictedValue: number | null;
  confidenceIntervalLow: number | null;
  confidenceIntervalHigh: number | null;
  factors: Array<{ name: string; impact: number; evidence: string }>;
  modelVersion: string;
  calculatedAt: string;
  dealName: string | null;
  dealStage: string | null;
  dealValue: number | null;
  companyName: string | null;
}

interface ForecastSummary {
  totalDeals: number;
  avgProbability: number;
  likelyRevenue: number;
  possibleRevenue: number;
  unlikelyRevenue: number;
  totalPredictedValue: number;
}

// Demo data
const DEMO_SUMMARY: ForecastSummary = {
  totalDeals: 12, avgProbability: 54.2, likelyRevenue: 285000,
  possibleRevenue: 142000, unlikelyRevenue: 68000, totalPredictedValue: 495000,
};

const DEMO_FORECASTS: Forecast[] = [
  { id: "1", dealId: "d1", predictedCloseProbability: 87, predictedCloseDate: "2026-04-15", predictedValue: 120000, confidenceIntervalLow: 78, confidenceIntervalHigh: 93, factors: [
    { name: "Champion engagement", impact: 25, evidence: "VP attended 3 demos, responded to all emails within 2h" },
    { name: "Multi-threaded deal", impact: 18, evidence: "4 stakeholders actively engaged" },
    { name: "Budget confirmed", impact: 15, evidence: "Budget mentioned in last email exchange" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), dealName: "Acme Corp — Enterprise License", dealStage: "negotiation", dealValue: 120000, companyName: "Acme Corp" },
  { id: "2", dealId: "d2", predictedCloseProbability: 72, predictedCloseDate: "2026-05-01", predictedValue: 85000, confidenceIntervalLow: 60, confidenceIntervalHigh: 82, factors: [
    { name: "Proposal reviewed", impact: 20, evidence: "Proposal opened 6 times, shared with 2 others" },
    { name: "Timeline alignment", impact: 12, evidence: "Target go-live matches Q2 planning" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), dealName: "TechStart — Growth Plan", dealStage: "proposal", dealValue: 85000, companyName: "TechStart" },
  { id: "3", dealId: "d3", predictedCloseProbability: 45, predictedCloseDate: "2026-06-30", predictedValue: 60000, confidenceIntervalLow: 30, confidenceIntervalHigh: 58, factors: [
    { name: "Single-threaded", impact: -15, evidence: "Only 1 contact engaged — no executive sponsor" },
    { name: "Long sales cycle", impact: -8, evidence: "Deal age: 45 days with no stage progression" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), dealName: "Globex — Expansion", dealStage: "discovery", dealValue: 60000, companyName: "Globex Inc" },
  { id: "4", dealId: "d4", predictedCloseProbability: 28, predictedCloseDate: null, predictedValue: 35000, confidenceIntervalLow: 15, confidenceIntervalHigh: 40, factors: [
    { name: "No activity", impact: -20, evidence: "No engagement in 14 days" },
    { name: "Competitor mention", impact: -12, evidence: "Competitor mentioned in last call" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), dealName: "NovaCorp — Pilot", dealStage: "qualified", dealValue: 35000, companyName: "NovaCorp" },
];

function ProbabilityBar({ probability }: { probability: number }) {
  const color = probability >= 70 ? "bg-green-500" : probability >= 40 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${probability}%` }} />
      </div>
      <span className="text-sm font-semibold tabular-nums">{probability}%</span>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const colors: Record<string, string> = {
    lead: "bg-gray-100 text-gray-700", qualified: "bg-blue-100 text-blue-700",
    discovery: "bg-indigo-100 text-indigo-700", proposal: "bg-purple-100 text-purple-700",
    negotiation: "bg-orange-100 text-orange-700", closed_won: "bg-green-100 text-green-700",
    closed_lost: "bg-red-100 text-red-700",
  };
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", colors[stage] ?? colors.lead)}>
      {stage.replace("_", " ")}
    </span>
  );
}

export default function ForecastingPage() {
  const { currency, locale } = useTenantContext();
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, sRes] = await Promise.all([
        api.get("/api/v1/forecasting"),
        api.get("/api/v1/forecasting/summary"),
      ]);
      if (fRes.ok) {
        const fJson = await fRes.json();
        setForecasts(fJson.data?.length ? fJson.data : DEMO_FORECASTS);
      } else {
        setForecasts(DEMO_FORECASTS);
      }
      if (sRes.ok) {
        const sJson = await sRes.json();
        setSummary(sJson.data?.totalDeals ? sJson.data : DEMO_SUMMARY);
      } else {
        setSummary(DEMO_SUMMARY);
      }
    } catch {
      setForecasts(DEMO_FORECASTS);
      setSummary(DEMO_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCompute = async () => {
    setComputing(true);
    try { await api.post("/api/v1/forecasting/compute", {}); setTimeout(fetchData, 2000); } catch {}
    finally { setComputing(false); }
  };

  const fmt = (v: number) => formatCurrency(v, currency, locale);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LineChart className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Predictive Forecasting</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={handleCompute} disabled={computing}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            <Zap className="h-4 w-4" />{computing ? "Computing…" : "Recompute"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <BarChart3 className="h-4 w-4" />
              <span className="text-xs">Avg Probability</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{summary.avgProbability}%</p>
          </div>
          <div className="rounded-lg border bg-green-50 p-4">
            <div className="flex items-center gap-2 text-green-600">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs">Likely (&ge;70%)</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-green-700">{fmt(summary.likelyRevenue)}</p>
          </div>
          <div className="rounded-lg border bg-yellow-50 p-4">
            <div className="flex items-center gap-2 text-yellow-600">
              <Target className="h-4 w-4" />
              <span className="text-xs">Possible (40–70%)</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-yellow-700">{fmt(summary.possibleRevenue)}</p>
          </div>
          <div className="rounded-lg border bg-red-50 p-4">
            <div className="flex items-center gap-2 text-red-600">
              <TrendingDown className="h-4 w-4" />
              <span className="text-xs">Unlikely (&lt;40%)</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-red-700">{fmt(summary.unlikelyRevenue)}</p>
          </div>
        </div>
      )}

      {/* Forecast table */}
      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Deal</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Stage</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Value</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">AI Probability</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Predicted Close</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Confidence Range</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 w-3/4 rounded bg-muted" /></td>
                  ))}
                </tr>
              ))
            ) : forecasts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No predictions available yet</td>
              </tr>
            ) : (
              forecasts.map((f) => (
                <>
                  <tr key={f.id} className="hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{f.dealName ?? "Unknown Deal"}</p>
                      <p className="text-xs text-muted-foreground">{f.companyName ?? ""}</p>
                    </td>
                    <td className="px-4 py-3">{f.dealStage ? <StageBadge stage={f.dealStage} /> : "—"}</td>
                    <td className="px-4 py-3 font-medium tabular-nums">{f.dealValue ? fmt(f.dealValue) : "—"}</td>
                    <td className="px-4 py-3"><ProbabilityBar probability={f.predictedCloseProbability} /></td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {f.predictedCloseDate ? new Date(f.predictedCloseDate).toLocaleDateString() : "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                      {f.confidenceIntervalLow != null && f.confidenceIntervalHigh != null
                        ? `${f.confidenceIntervalLow}% – ${f.confidenceIntervalHigh}%`
                        : "—"}
                    </td>
                  </tr>
                  {expandedId === f.id && (
                    <tr key={`${f.id}-factors`}>
                      <td colSpan={6} className="bg-muted/30 px-8 py-4">
                        <p className="text-xs font-medium uppercase text-muted-foreground mb-2">AI Factors</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {f.factors.map((factor, i) => (
                            <div key={i} className="rounded-lg border bg-card p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium">{factor.name}</span>
                                <span className={cn("text-sm font-semibold", factor.impact >= 0 ? "text-green-600" : "text-red-600")}>
                                  {factor.impact >= 0 ? "+" : ""}{factor.impact}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">{factor.evidence}</p>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
