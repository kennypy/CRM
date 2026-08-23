"use client";

/**
 * White-label embedded report view — the public page an embed token URL
 * renders, designed to live inside an iframe on a customer's own site or
 * wiki. No app chrome, no navigation, no branding beyond the report itself;
 * data comes from the public embed proxy (the signed token is the
 * credential).
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";

interface EmbedData {
  name: string;
  description: string | null;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  generatedAt: string;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function EmbeddedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<EmbedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/embed/report/${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error?.message ?? "This embed link is invalid or has expired.");
      } else {
        setData(json.data);
      }
    } catch {
      setError("Could not load the report.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const numericKeys = useMemo(() => {
    if (!data) return new Set<string>();
    const keys = new Set<string>();
    for (const c of data.columns) {
      if (data.rows.some((r) => typeof r[c.key] === "number")) keys.add(c.key);
    }
    return keys;
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="h-40 w-full max-w-3xl animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-xl border p-6 text-center">
          <p className="text-sm font-medium">Report unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{error ?? "Unknown error."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">{data.name}</h1>
            {data.description && <p className="text-sm text-muted-foreground">{data.description}</p>}
          </div>
          <p className="text-xs text-muted-foreground">
            {data.rowCount.toLocaleString()} row{data.rowCount === 1 ? "" : "s"} · updated{" "}
            {new Date(data.generatedAt).toLocaleString()} ·{" "}
            <button onClick={load} className="underline hover:text-foreground">refresh</button>
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {data.columns.map((c) => (
                  <th key={c.key} className={`px-4 py-2 font-medium ${numericKeys.has(c.key) ? "text-right" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {data.columns.map((c) => (
                    <td key={c.key} className={`px-4 py-2 ${numericKeys.has(c.key) ? "text-right tabular-nums" : ""}`}>
                      {formatCell(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={data.columns.length || 1} className="px-4 py-8 text-center text-muted-foreground">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
