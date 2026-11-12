"use client";

/**
 * Settings → Price Books. A price book is a per-currency price list over the
 * product catalog; quotes pick a book and line items take the book's price.
 * Entries are edited as a grid and saved with a single replacing PUT.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, BookOpen, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  deleteData, errorMessage, getData, sendData,
  type PriceBook, type PriceBookEntry,
} from "@/lib/l2q";

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY", "CHF", "INR", "BRL"];

interface CatalogProduct { id: string; name: string; sku?: string | null; unitPrice: number; currency: string; active: boolean; }

type BookDraft = Omit<PriceBook, "id" | "description"> & { id?: string; description: string };

function BookEditor({ draft, onClose, onSaved }: { draft: BookDraft; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("priceBooks");
  const tc = useTranslations("common");
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!d.name.trim()) { setError(t("nameRequired")); return; }
    setBusy(true); setError(null);
    try {
      const body = { name: d.name.trim(), description: d.description.trim() || null, currency: d.currency, isStandard: d.isStandard, active: d.active };
      if (d.id) await sendData("patch", `/api/v1/price-books/${d.id}`, body);
      else await sendData("post", "/api/v1/price-books", body);
      onSaved();
    } catch (e) { setError(errorMessage(e, t("saveFailed"))); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{d.id ? t("editBook") : t("newBook")}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>{t("name")}</label>
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("descriptionLabel")}</label>
            <input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("currency")}</label>
            <select value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value })} disabled={!!d.id} className={inputCls}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.isStandard} onChange={(e) => setD({ ...d, isStandard: e.target.checked })} className="rounded border-border" />
            {t("isStandard")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="rounded border-border" />
            {t("active")}
          </label>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">{tc("cancel")}</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy ? t("saving") : tc("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface EntryRow { productId: string; productName: string; included: boolean; unitPrice: string; active: boolean; }

function EntriesEditor({ book, onClose }: { book: PriceBook; onClose: () => void }) {
  const t = useTranslations("priceBooks");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [entries, prodRes] = await Promise.all([
          getData<PriceBookEntry[]>(`/api/v1/price-books/${book.id}/entries`),
          api.get("/api/v1/products"),
        ]);
        const products: CatalogProduct[] = prodRes.ok ? ((await prodRes.json()).data ?? []) : [];
        const byProduct = new Map((entries ?? []).map((e) => [e.productId, e]));
        const merged: EntryRow[] = products.map((p) => {
          const e = byProduct.get(p.id);
          return { productId: p.id, productName: p.name, included: !!e, unitPrice: String(e?.unitPrice ?? p.unitPrice ?? 0), active: e?.active ?? true };
        });
        // Entries whose product isn't in the catalog response (e.g. archived) stay visible.
        for (const e of entries ?? []) {
          if (!products.some((p) => p.id === e.productId)) {
            merged.push({ productId: e.productId, productName: e.productName, included: true, unitPrice: String(e.unitPrice), active: e.active });
          }
        }
        if (alive) setRows(merged);
      } catch (e) { if (alive) setError(errorMessage(e, t("loadFailed"))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [book.id, t]);

  const save = async () => {
    const included = rows.filter((r) => r.included);
    const bad = included.find((r) => r.unitPrice.trim() === "" || Number.isNaN(Number(r.unitPrice)) || Number(r.unitPrice) < 0);
    if (bad) { setError(t("badPrice", { product: bad.productName })); return; }
    setBusy(true); setError(null); setSaved(false);
    try {
      await sendData("put", `/api/v1/price-books/${book.id}/entries`, {
        entries: included.map((r) => ({ productId: r.productId, unitPrice: Number(r.unitPrice), active: r.active })),
      });
      setSaved(true);
    } catch (e) { setError(errorMessage(e, t("saveFailed"))); }
    finally { setBusy(false); }
  };

  const update = (id: string, patch: Partial<EntryRow>) => { setSaved(false); setRows((prev) => prev.map((r) => r.productId === id ? { ...r, ...patch } : r)); };
  const visible = rows.filter((r) => !search || r.productName.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex w-full max-w-3xl flex-col rounded-2xl border bg-card shadow-xl" style={{ maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold">{t("entriesTitle", { name: book.name })}</h2>
            <p className="text-xs text-muted-foreground">{t("entriesHint", { currency: book.currency })}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="border-b px-5 py-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchProducts")} className={inputCls} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("loading")}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("noProducts")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr>
                  {[t("include"), t("product"), t("listPrice", { currency: book.currency }), t("entryActive")].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((r) => (
                  <tr key={r.productId} className={cn(!r.included && "opacity-60")}>
                    <td className="px-4 py-2"><input type="checkbox" checked={r.included} onChange={(e) => update(r.productId, { included: e.target.checked })} className="rounded border-border" /></td>
                    <td className="px-4 py-2 font-medium">{r.productName}</td>
                    <td className="px-4 py-2">
                      <input type="number" min="0" step="0.01" value={r.unitPrice} disabled={!r.included}
                        onChange={(e) => update(r.productId, { unitPrice: e.target.value })}
                        className="w-32 rounded border border-border bg-background px-2 py-1 text-right text-sm tabular-nums" />
                    </td>
                    <td className="px-4 py-2"><input type="checkbox" checked={r.active} disabled={!r.included} onChange={(e) => update(r.productId, { active: e.target.checked })} className="rounded border-border" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {error && (
          <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          {saved && <span className="mr-auto text-sm text-green-700">{t("savedEntries")}</span>}
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">{tc("close")}</button>
          <button onClick={save} disabled={busy || loading} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy ? t("saving") : t("saveEntries")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PriceBooksTab() {
  const t = useTranslations("priceBooks");
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BookDraft | null>(null);
  const [entriesFor, setEntriesFor] = useState<PriceBook | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setBooks((await getData<PriceBook[]>("/api/v1/price-books")) ?? []); }
    catch (e) { setError(errorMessage(e, t("loadFailed"))); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const remove = async (b: PriceBook) => {
    if (!confirm(t("deleteConfirm", { name: b.name }))) return;
    try { await deleteData(`/api/v1/price-books/${b.id}`); load(); }
    catch (e) { setError(errorMessage(e, t("deleteFailed"))); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <button onClick={() => setEditing({ name: "", description: "", currency: "USD", isStandard: books.length === 0, active: true })}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" />{t("newBook")}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {[t("name"), t("currency"), t("active"), ""].map((h, i) => (
                <th key={i} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t("loading")}</td></tr>
            ) : books.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t("empty")}</td></tr>
            ) : books.map((b) => (
              <tr key={b.id} className="hover:bg-muted/20">
                <td className="px-4 py-2.5">
                  <p className="flex items-center gap-1.5 font-medium">{b.name}{b.isStandard && <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" aria-label={t("standard")} />}</p>
                  {b.description && <p className="text-xs text-muted-foreground">{b.description}</p>}
                </td>
                <td className="px-4 py-2.5">{b.currency}</td>
                <td className="px-4 py-2.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", b.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                    {b.active ? t("on") : t("off")}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setEntriesFor(b)} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"><BookOpen className="h-3.5 w-3.5" />{t("prices")}</button>
                    <button onClick={() => setEditing({ id: b.id, name: b.name, description: b.description ?? "", currency: b.currency, isStandard: b.isStandard, active: b.active })}
                      className="rounded p-1 text-muted-foreground hover:bg-muted"><Pencil className="h-3.5 w-3.5" /></button>
                    {!b.isStandard && (
                      <button onClick={() => remove(b)} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <BookEditor draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {entriesFor && <EntriesEditor book={entriesFor} onClose={() => setEntriesFor(null)} />}
    </div>
  );
}
