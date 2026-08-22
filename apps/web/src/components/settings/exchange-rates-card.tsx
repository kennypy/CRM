"use client";

/**
 * Settings → Company → Exchange rates (multi-currency).
 *
 * Rates are expressed as units of the currency per 1 unit of the workspace
 * base currency. Cross-currency rollups (forecasting, pipeline totals)
 * convert deal values into the base using this table.
 */

import { useEffect, useState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";

import { api } from "@/lib/api";

interface RateRow { currency: string; rate: string }

export function ExchangeRatesCard() {
  const [base, setBase]     = useState("USD");
  const [rows, setRows]     = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    api.get("/api/v1/tenant/exchange-rates")
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          setBase(j.data.base);
          setRows(
            Object.entries(j.data.rates as Record<string, number>)
              .filter(([c]) => c !== j.data.base)
              .map(([currency, rate]) => ({ currency, rate: String(rate) }))
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setError(null); setSaved(false);
    const rates: Record<string, number> = {};
    for (const r of rows) {
      const cur = r.currency.trim().toUpperCase();
      const val = parseFloat(r.rate);
      if (!/^[A-Z]{3}$/.test(cur)) { setError(`"${r.currency}" is not a 3-letter currency code`); setSaving(false); return; }
      if (!(val > 0)) { setError(`Rate for ${cur} must be a positive number`); setSaving(false); return; }
      rates[cur] = val;
    }
    try {
      const res = await api.put("/api/v1/tenant/exchange-rates", { rates });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error?.message ?? "Failed to save rates"); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="mt-6 max-w-xl rounded-xl border p-5">
      <h2 className="text-sm font-semibold">Exchange rates</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Units of each currency per 1 {base}. Used to convert deal values into {base} for
        cross-currency forecasts and rollups.
      </p>

      <div className="mt-4 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={r.currency}
              onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, currency: e.target.value.toUpperCase() } : x))}
              placeholder="EUR"
              maxLength={3}
              className="w-24 rounded-lg border bg-background px-3 py-2 text-sm uppercase"
            />
            <span className="text-sm text-muted-foreground">=</span>
            <input
              value={r.rate}
              onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))}
              placeholder="0.92"
              inputMode="decimal"
              className="w-36 rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <span className="text-sm text-muted-foreground">per 1 {base}</span>
            <button onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
              className="rounded-md p-1 text-muted-foreground hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No rates configured — all deals are assumed to be in {base}.</p>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={() => setRows((p) => [...p, { currency: "", rate: "" }])}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
          <Plus className="h-4 w-4" /> Add currency
        </button>
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save rates"}
        </button>
      </div>
    </div>
  );
}
