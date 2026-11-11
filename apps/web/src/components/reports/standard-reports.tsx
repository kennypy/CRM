"use client";

/**
 * Standard Lead-to-Quote reports (conversion, pipeline, stage duration, win
 * rate, approval cycle time, quote status) served by
 * GET /api/v1/reports/standard[/:key]. Read-only table + date range + CSV.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Download, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  errorMessage, formatReportCell, getData,
  type StandardReportDef, type StandardReportResult,
} from "@/lib/l2q";

function isoDaysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10);
}

function toCsv(result: StandardReportResult): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formula injection, then quote.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = result.columns.map((c) => esc(c.label)).join(",");
  const body = result.rows.map((r) => result.columns.map((c) => esc(r[c.key])).join(",")).join("\n");
  return `${head}\n${body}`;
}

export function StandardReports() {
  const t = useTranslations("standardReports");
  const [defs, setDefs] = useState<StandardReportDef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [result, setResult] = useState<StandardReportResult | null>(null);
  const [loadingDefs, setLoadingDefs] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getData<StandardReportDef[]>("/api/v1/reports/standard")
      .then((d) => { setDefs(d ?? []); if (d?.length) setSelected(d[0].key); })
      .catch((e) => setError(errorMessage(e, t("loadFailed"))))
      .finally(() => setLoadingDefs(false));
  }, [t]);

  const run = useCallback(async () => {
    if (!selected) return;
    if (from && to && from > to) { setError(t("badRange")); return; }
    setRunning(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      setResult(await getData<StandardReportResult>(`/api/v1/reports/standard/${encodeURIComponent(selected)}?${qs}`));
    } catch (e) { setError(errorMessage(e, t("runFailed"))); setResult(null); }
    finally { setRunning(false); }
  }, [selected, from, to, t]);

  useEffect(() => { if (selected) run(); }, [selected]);

  const download = () => {
    if (!result) return;
    const blob = new Blob([toCsv(result)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${selected ?? "report"}_${from}_${to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const current = defs.find((d) => d.key === selected);

  if (loadingDefs) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />{t("loading")}</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-1">
        {defs.length === 0 && <p className="text-sm text-muted-foreground">{t("none")}</p>}
        {defs.map((d) => (
          <button key={d.key} onClick={() => setSelected(d.key)}
            className={cn("w-full rounded-lg border px-3 py-2 text-left transition-colors",
              selected === d.key ? "border-violet-500 bg-violet-500/10" : "border-border hover:bg-muted")}>
            <p className="text-sm font-medium">{d.name}</p>
            <p className="text-xs text-muted-foreground">{d.description}</p>
          </button>
        ))}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("from")}</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("to")}</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
          </div>
          <button onClick={run} disabled={running || !selected}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{t("run")}
          </button>
          {result && result.rows.length > 0 && (
            <button onClick={download} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
              <Download className="h-3.5 w-3.5" />CSV
            </button>
          )}
        </div>

        {current && <h3 className="text-sm font-semibold">{current.name}</h3>}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        {result && (
          result.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{t("noRows")}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key} className={cn("px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                        ["number", "integer", "currency", "percent", "duration_hours", "duration_days"].includes(c.type) ? "text-right" : "text-left")}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      {result.columns.map((c) => (
                        <td key={c.key} className={cn("px-4 py-2",
                          ["number", "integer", "currency", "percent", "duration_hours", "duration_days"].includes(c.type) ? "text-right tabular-nums" : "")}>
                          {formatReportCell(r[c.key], c.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
