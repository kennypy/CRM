"use client";

/**
 * Products CSV import with smart mapping. Upload a spreadsheet (e.g. a Salesforce
 * products export) → the server proposes a mapping (standard fields vs new custom
 * fields to auto-create) → review/adjust → import. Admin-only (parent tab gates).
 */

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { UploadCloud, X, ArrowRight, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet } from "lucide-react";

const STANDARD_FIELDS = [
  { value: "name", label: "Name" },
  { value: "sku", label: "SKU / Code" },
  { value: "description", label: "Description" },
  { value: "unit_price", label: "Unit price" },
  { value: "currency", label: "Currency" },
  { value: "billing_cycle", label: "Billing cycle" },
];
const NEW_TYPES = ["text", "number", "date", "boolean", "email", "url", "currency"];

interface MapItem {
  header: string; index: number;
  target: "standard" | "custom_existing" | "new" | "skip";
  field?: string; fieldKey?: string; fieldLabel?: string; fieldType?: string; sample?: string;
}
interface Analysis { headers: string[]; rowCount: number; mapping: MapItem[]; sampleRows: string[][] }
interface Result { created: number; updated: number; skipped: number; fieldsCreated: number; total: number; errors: { row: number; message: string }[] }

export function ProductsImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<"upload" | "map" | "done">("upload");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<MapItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result ?? "")); };
    reader.readAsText(f);
  };

  const analyze = async () => {
    if (!csv.trim()) { setError("Choose a CSV file first."); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.post("/api/v1/products/import/analyze", { csv });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.error?.message ?? "Couldn't read that file."); return; }
      setAnalysis(d.data);
      setMapping(d.data.mapping);
      setStep("map");
    } catch { setError("Network error — please try again."); } finally { setBusy(false); }
  };

  const updateItem = (index: number, patch: Partial<MapItem>) =>
    setMapping((m) => m.map((it) => (it.index === index ? { ...it, ...patch } : it)));

  const setTarget = (it: MapItem, value: string) => {
    if (value === "skip") return updateItem(it.index, { target: "skip", field: undefined });
    if (value === "new") {
      const key = it.header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
      return updateItem(it.index, { target: "new", field: undefined, fieldKey: key, fieldLabel: it.fieldLabel || it.header, fieldType: it.fieldType || "text" });
    }
    // standard field value
    updateItem(it.index, { target: "standard", field: value });
  };

  const commit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.post("/api/v1/products/import/commit", { csv, mapping });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.error?.message ?? "Import failed."); return; }
      setResult(d.data);
      setStep("done");
      onDone();
    } catch { setError("Network error — please try again."); } finally { setBusy(false); }
  };

  const hasName = mapping.some((m) => m.target === "standard" && m.field === "name");
  const newCount = mapping.filter((m) => m.target === "new").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="h-4 w-4 text-primary" /> Import products from CSV</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload a product export (e.g. from Salesforce). We&apos;ll read the headers, map what we recognise, and offer to create custom fields for the rest.
              </p>
              <button onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-10 text-center hover:border-primary/50 hover:bg-muted/30">
                <UploadCloud className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">{fileName || "Choose a CSV file"}</span>
                <span className="text-xs text-muted-foreground">.csv exported from Salesforce, HubSpot, or a spreadsheet</span>
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])} />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end">
                <button onClick={analyze} disabled={busy || !csv.trim()}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Analyze
                </button>
              </div>
            </div>
          )}

          {step === "map" && analysis && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {analysis.rowCount} rows · {analysis.headers.length} columns. Review the mapping — new custom fields will be created on import.
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-2 text-left">Column</th><th className="px-3 py-2 text-left">Sample</th><th className="px-3 py-2 text-left">Maps to</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mapping.map((it) => (
                      <tr key={it.index}>
                        <td className="px-3 py-2 font-medium">{it.header}</td>
                        <td className="px-3 py-2 max-w-[180px] truncate text-muted-foreground">{it.sample || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={it.target === "standard" ? it.field : it.target === "new" ? "new" : it.target === "skip" ? "skip" : "new"}
                              onChange={(e) => setTarget(it, e.target.value)}
                              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30">
                              <optgroup label="Standard field">
                                {STANDARD_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                              </optgroup>
                              <option value="new">➕ Create custom field</option>
                              <option value="skip">Skip this column</option>
                            </select>
                            {it.target === "new" && (
                              <>
                                <input value={it.fieldLabel ?? ""} onChange={(e) => updateItem(it.index, { fieldLabel: e.target.value })}
                                  placeholder="Field label" className="w-32 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30" />
                                <select value={it.fieldType ?? "text"} onChange={(e) => updateItem(it.index, { fieldType: e.target.value })}
                                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30">
                                  {NEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </>
                            )}
                            {it.target === "custom_existing" && <span className="text-xs text-muted-foreground">existing field</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!hasName && <p className="flex items-center gap-1.5 text-sm text-amber-600"><AlertCircle className="h-4 w-4" /> Map one column to <b>Name</b> to continue.</p>}
              {newCount > 0 && <p className="text-xs text-muted-foreground">{newCount} new custom field{newCount === 1 ? "" : "s"} will be created on the Product object.</p>}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-between">
                <button onClick={() => setStep("upload")} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Back</button>
                <button onClick={commit} disabled={busy || !hasName}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Import {analysis.rowCount} rows
                </button>
              </div>
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
              <h3 className="text-lg font-semibold">Import complete</h3>
              <div className="mx-auto grid max-w-sm grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-border p-3"><div className="text-2xl font-bold text-green-600">{result.created}</div>created</div>
                <div className="rounded-lg border border-border p-3"><div className="text-2xl font-bold text-blue-600">{result.updated}</div>updated</div>
                <div className="rounded-lg border border-border p-3"><div className="text-2xl font-bold">{result.fieldsCreated}</div>new fields</div>
                <div className="rounded-lg border border-border p-3"><div className="text-2xl font-bold text-muted-foreground">{result.skipped}</div>skipped</div>
              </div>
              {result.errors.length > 0 && (
                <div className="mx-auto max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800">
                  <p className="mb-1 font-medium">{result.errors.length} row(s) had issues:</p>
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                    {result.errors.slice(0, 10).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
                  </ul>
                </div>
              )}
              <button onClick={onClose} className="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
