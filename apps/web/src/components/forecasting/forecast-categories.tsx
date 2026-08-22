"use client";

/**
 * Enterprise forecast — call / commit / best-case categories.
 *
 * Category totals are converted into the workspace base currency using the
 * tenant exchange-rate table; managers can override committed amounts per
 * deal (API-side permission — the control renders for everyone but 403s for
 * reps).
 */

import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

import { api } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";
import { usePermissions } from "@/lib/permissions";

interface RollupDeal {
  dealId: string;
  name: string | null;
  stage: string;
  value: number;
  currency: string;
  baseValue: number;
  overrideAmount: number | null;
  category: string;
}
interface Rollup {
  currency: string;
  categories: Record<string, { count: number; amount: number }>;
  aiLikelyRevenue: number;
  unconvertedCount: number;
  deals: RollupDeal[];
}

const CATEGORY_META: Array<{ key: string; label: string; tone: string }> = [
  { key: "commit",    label: "Commit",    tone: "text-emerald-600" },
  { key: "best_case", label: "Best case", tone: "text-blue-600" },
  { key: "pipeline",  label: "Pipeline",  tone: "text-amber-600" },
  { key: "closed",    label: "Closed won", tone: "text-violet-600" },
];

const SELECTABLE = ["pipeline", "best_case", "commit", "omitted"];

export function ForecastCategories() {
  const { isManager } = usePermissions();
  const [rollup, setRollup]   = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/api/v1/forecasting/rollup");
      const json = await res.json().catch(() => null);
      if (json?.success) setRollup(json.data);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setCategory = async (dealId: string, category: string) => {
    setError(null);
    const res = await api.put(`/api/v1/forecasting/deals/${dealId}/category`, { category }).catch(() => null);
    if (!res?.ok) { setError("Failed to update category"); return; }
    await load();
  };

  const setOverride = async (dealId: string, raw: string) => {
    setError(null);
    const deal = rollup?.deals.find((d) => d.dealId === dealId);
    if (!deal) return;
    const overrideAmount = raw.trim() === "" ? null : parseFloat(raw);
    if (overrideAmount !== null && !(overrideAmount >= 0)) return;
    const res = await api.put(`/api/v1/forecasting/deals/${dealId}/category`, {
      category: deal.category,
      overrideAmount,
    }).catch(() => null);
    if (!res?.ok) { setError("Failed to save override (managers only)"); return; }
    await load();
  };

  if (loading) return <div className="h-28 animate-pulse rounded-xl bg-muted" />;
  if (!rollup) return null;

  const openDeals = rollup.deals.filter((d) => d.category !== "closed");

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Forecast categories</h2>
        <p className="text-sm text-muted-foreground">
          Call your number: commit / best case / pipeline, rolled up in {rollup.currency}
          {rollup.unconvertedCount > 0 && (
            <span className="text-amber-600"> · {rollup.unconvertedCount} deal(s) missing an exchange rate</span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {CATEGORY_META.map((c) => {
          const t = rollup.categories[c.key] ?? { count: 0, amount: 0 };
          return (
            <div key={c.key} className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
              <p className={cn("mt-1 text-xl font-bold", c.tone)}>
                {formatCurrency(t.amount, rollup.currency, true)}
              </p>
              <p className="text-xs text-muted-foreground">{t.count} deal{t.count === 1 ? "" : "s"}</p>
            </div>
          );
        })}
        <div className="rounded-xl border border-dashed p-4">
          <p className="text-xs font-medium text-muted-foreground">AI predicted (≥70%)</p>
          <p className="mt-1 text-xl font-bold">{formatCurrency(rollup.aiLikelyRevenue, rollup.currency, true)}</p>
          <p className="text-xs text-muted-foreground">model comparison</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Deal</th>
              <th className="px-4 py-2 font-medium">Stage</th>
              <th className="px-4 py-2 font-medium">Value</th>
              <th className="px-4 py-2 font-medium">In {rollup.currency}</th>
              <th className="px-4 py-2 font-medium">Category</th>
              {isManager && <th className="px-4 py-2 font-medium">Override ({rollup.currency})</th>}
            </tr>
          </thead>
          <tbody>
            {openDeals.map((d) => (
              <tr key={d.dealId} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">{d.name ?? d.dealId.slice(0, 8)}</td>
                <td className="px-4 py-2 capitalize text-muted-foreground">{d.stage.replace(/_/g, " ")}</td>
                <td className="px-4 py-2">{formatCurrency(d.value, d.currency)}</td>
                <td className="px-4 py-2">{formatCurrency(d.baseValue, rollup.currency)}</td>
                <td className="px-4 py-2">
                  <select
                    value={d.category}
                    onChange={(e) => setCategory(d.dealId, e.target.value)}
                    className="rounded-md border bg-background px-2 py-1 text-xs"
                  >
                    {SELECTABLE.map((c) => (
                      <option key={c} value={c}>{c.replace("_", " ")}</option>
                    ))}
                  </select>
                </td>
                {isManager && (
                  <td className="px-4 py-2">
                    <input
                      defaultValue={d.overrideAmount ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value;
                        if ((d.overrideAmount ?? "") !== (v === "" ? "" : parseFloat(v))) setOverride(d.dealId, v);
                      }}
                      placeholder="—"
                      inputMode="decimal"
                      className="w-28 rounded-md border bg-background px-2 py-1 text-xs"
                    />
                  </td>
                )}
              </tr>
            ))}
            {openDeals.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No open deals</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
