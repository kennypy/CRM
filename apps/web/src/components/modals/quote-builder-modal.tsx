"use client";

import { useState, useEffect, useCallback } from "react";
import { useRef } from "react";
import {
  X, Plus, Trash2, FileText,
  AlertCircle, Search, Package, Info, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  DEMO_PRODUCTS, BILLING_CYCLE_LABELS,
  computeLineTotal, computeQuoteTotals,
  fmtCurrency, STATUS_COLORS, STATUS_LABELS,
  type Quote, type QuoteItem, type Product,
} from "@/lib/quotes";

interface Props {
  /** Pre-fill context */
  dealId?:      string;
  dealName?:    string;
  companyId?:   string;
  companyName?: string;
  contactId?:   string;
  contactName?: string;
  /** NL-parsed items to pre-fill (from ActionBar) */
  initialItems?: Omit<DraftItem, "_key">[];
  /** NL-parsed order-level discount to pre-fill */
  initialOrderDiscount?: { type: "percent" | "fixed"; value: number };
  /** Edit mode */
  existing?:    Quote;
  /** Discount approval threshold (from tenant settings, default 10) */
  discountThreshold?: number;
  onClose:   () => void;
  onSaved:   (q: Quote) => void;
}

interface DraftItem extends QuoteItem {
  _key: string; // local React key
}

const DEFAULT_TERMS = `Payment due within 30 days of invoice date.\nPrices exclude VAT/tax where applicable.\nThis quote is valid for the period stated above.`;

function newDraftItem(product?: Product): DraftItem {
  return {
    _key:        crypto.randomUUID(),
    productId:   product?.id ?? null,
    productName: product?.name ?? "",
    description: product?.description ?? null,
    quantity:    1,
    unitPrice:   product?.unitPrice ?? 0,
    discountPct: 0,
    lineTotal:   product?.unitPrice ?? 0,
  };
}

export function QuoteBuilderModal({
  dealId, dealName, companyId, companyName, contactId, contactName,
  initialItems, initialOrderDiscount, existing, discountThreshold = 10,
  onClose, onSaved,
}: Props) {
  const isEdit = !!existing;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(() => {
    if (existing?.title) return existing.title;
    const base = dealName || companyName || null;  // || treats "" as falsy, unlike ??
    if (initialItems?.[0]) {
      const p = initialItems[0];
      return `${base ?? "Quote"} — ${p.productName}${p.quantity !== 1 ? ` × ${p.quantity}` : ""}`;
    }
    return base ? `Quote for ${base}` : "New Quote";
  });
  const [currency,      setCurrency]      = useState(existing?.currency     ?? "GBP");
  const [notes,         setNotes]         = useState(existing?.notes        ?? "");
  const [terms,         setTerms]         = useState(existing?.terms        ?? DEFAULT_TERMS);
  const [validUntil,    setValidUntil]    = useState(existing?.validUntil   ?? (() => {
    const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10);
  })());
  const [taxRate,       setTaxRate]       = useState(existing?.taxRate      ?? 0);
  // When editing a quote whose discount was stored per-line (order discount = "none"),
  // reflect the uniform line discount in the Order Discount field for UI clarity.
  const [discountType, setDiscountType] = useState<"none"|"percent"|"fixed">(() => {
    if (existing?.discountType && existing.discountType !== "none") return existing.discountType;
    if (existing?.items?.length) {
      const d0 = existing.items[0]?.discountPct ?? 0;
      if (d0 > 0 && existing.items.every((it) => Math.abs(it.discountPct - d0) < 0.001)) return "percent";
    }
    return initialOrderDiscount?.type ?? "none";
  });
  const [discountValue, setDiscountValue] = useState(() => {
    if (existing?.discountValue && existing.discountValue > 0) return existing.discountValue;
    if (existing?.items?.length) {
      const d0 = existing.items[0]?.discountPct ?? 0;
      if (d0 > 0 && existing.items.every((it) => Math.abs(it.discountPct - d0) < 0.001)) return d0;
    }
    return initialOrderDiscount?.value ?? 0;
  });

  // ── Contact link ───────────────────────────────────────────────────────────
  const [linkedContact, setLinkedContact] = useState<{ id: string; name: string; email?: string } | null>(
    () => (contactId && contactName) ? { id: contactId, name: contactName } : null
  );
  const [contactSearch,  setContactSearch]  = useState("");
  const [contactResults, setContactResults] = useState<{ id: string; name: string; email: string }[]>([]);
  const [contactOpen,    setContactOpen]    = useState(false);
  const contactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContactSearch = (q: string) => {
    setContactSearch(q);
    if (!q.trim()) { setContactResults([]); return; }
    if (contactTimer.current) clearTimeout(contactTimer.current);
    contactTimer.current = setTimeout(async () => {
      try {
        const res = await api.get(`/api/v1/contacts?search=${encodeURIComponent(q)}&limit=8`);
        const j   = await res.json();
        setContactResults((j.data ?? []).map((c: Record<string, unknown>) => ({
          id:    String(c.id),
          name:  `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
          email: String(c.email ?? ""),
        })));
        setContactOpen(true);
      } catch { setContactResults([]); }
    }, 300);
  };

  const [items, setItems] = useState<DraftItem[]>(() => {
    if (existing?.items?.length) {
      return existing.items.map((it) => ({ ...it, _key: crypto.randomUUID() }));
    }
    if (initialItems?.length) {
      return initialItems.map((it) => ({
        ...it,
        _key: crypto.randomUUID(),
        lineTotal: computeLineTotal(it.quantity, it.unitPrice, it.discountPct ?? 0),
      }));
    }
    return [newDraftItem()];
  });

  // ── Product picker ─────────────────────────────────────────────────────────
  const [products,      setProducts]      = useState<Product[]>(DEMO_PRODUCTS);
  const [pickerRow,     setPickerRow]     = useState<string | null>(null);
  const [pickerSearch,  setPickerSearch]  = useState("");

  useEffect(() => {
    api.get("/api/v1/products")
      .then((r) => r.json())
      .then((j) => { if (j.data?.length) setProducts(j.data); })
      .catch(() => { /* use demo data */ });
  }, []);

  const filteredProducts = products.filter((p) =>
    pickerSearch === "" ||
    p.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
    (p.sku ?? "").toLowerCase().includes(pickerSearch.toLowerCase())
  );

  // ── Computed totals ────────────────────────────────────────────────────────
  const totals = computeQuoteTotals(items, discountType, discountValue, taxRate);

  const maxDiscount = Math.max(0, ...items.map((it) => it.discountPct),
    discountType === "percent" ? discountValue : 0);
  const needsApproval = maxDiscount > discountThreshold;

  // ── Line item helpers ──────────────────────────────────────────────────────
  const updateItem = useCallback((key: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it) => {
      if (it._key !== key) return it;
      const next = { ...it, ...patch };
      next.lineTotal = computeLineTotal(next.quantity, next.unitPrice, next.discountPct);
      return next;
    }));
  }, []);

  const removeItem = (key: string) => setItems((prev) => prev.filter((it) => it._key !== key));
  const addItem    = () => setItems((prev) => [...prev, newDraftItem()]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim() || items.some((it) => !it.productName.trim() || it.quantity <= 0)) {
      setError("Please fill in all required fields and ensure quantities are greater than 0.");
      return;
    }
    setSaving(true); setError(null);
    try {
      // If per-line discounts already match the order discount, don't double-apply.
      // Send only the per-line discount (clear order level) so totals are correct.
      const allLinesMatchOrder =
        discountType === "percent" &&
        discountValue > 0 &&
        items.every((it) => Math.abs(it.discountPct - discountValue) < 0.001);

      const body = {
        title, currency, notes: notes || undefined, terms: terms || undefined,
        validUntil: validUntil || undefined,
        taxRate,
        discountType:  allLinesMatchOrder ? "none" : discountType,
        discountValue: allLinesMatchOrder ? 0      : discountValue,
        dealId:      dealId      || existing?.dealId      || undefined,
        companyId:   companyId   || existing?.companyId   || undefined,
        companyName: companyName || existing?.companyName || undefined,
        contactId:   linkedContact?.id   || contactId   || existing?.contactId   || undefined,
        contactName: linkedContact?.name || contactName || existing?.contactName || undefined,
        items: items.map((it) => ({
          // Only send productId if it's a real UUID (demo catalog uses "prod-001" style IDs)
          productId:   it.productId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(it.productId) ? it.productId : undefined,
          productName: it.productName,
          description: it.description ?? undefined,
          quantity:    it.quantity,
          unitPrice:   it.unitPrice,
          discountPct: it.discountPct,
        })),
      };

      const res = isEdit
        ? await api.patch(`/api/v1/quotes/${existing!.id}`, body)
        : await api.post("/api/v1/quotes", body);

      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? "Failed to save quote"); return; }
      onSaved(json.data);
      onClose();
    } catch { setError("Network error — please try again"); }
    finally { setSaving(false); }
  };

  const inputCls   = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls   = "mb-1 block text-xs font-semibold text-muted-foreground uppercase tracking-wide";
  const numberCls  = cn(inputCls, "text-right");

  const CURRENCIES = ["GBP","USD","EUR","CAD","AUD","SGD","CHF","JPY"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-5xl flex-col rounded-2xl border bg-card shadow-2xl" style={{ maxHeight: "95vh" }}>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold">{isEdit ? "Edit Quote" : "New Quote"}</h2>
              {(companyName || dealName) && (
                <p className="text-xs text-muted-foreground">{dealName ?? companyName}</p>
              )}
            </div>
            {needsApproval && (
              <span className="flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                <Info className="h-3 w-3" /> Requires manager approval
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {/* Body — scrollable */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left: title, currency, validity, notes, terms */}
          <div className="w-56 shrink-0 overflow-y-auto border-r p-4 space-y-4">
            <div>
              <label className={labelCls}>Quote title *</label>
              <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={3}
                className={cn(inputCls, "resize-none text-sm")} placeholder="e.g. Acme Corp — 5 seats" />
            </div>
            {/* Contact */}
            <div>
              <label className={labelCls}>Contact</label>
              {linkedContact ? (
                <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <User className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{linkedContact.name}</p>
                      {linkedContact.email && <p className="text-xs text-muted-foreground truncate">{linkedContact.email}</p>}
                    </div>
                  </div>
                  <button type="button" onClick={() => { setLinkedContact(null); setContactSearch(""); }}
                    className="ml-1 shrink-0 text-muted-foreground hover:text-red-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={contactSearch} onChange={(e) => handleContactSearch(e.target.value)}
                    onFocus={() => contactResults.length > 0 && setContactOpen(true)}
                    placeholder="Search contacts…"
                    className={cn(inputCls, "pl-8 text-xs")} />
                  {contactOpen && contactResults.length > 0 && (
                    <div className="absolute top-full mt-1 z-20 w-full rounded-xl border bg-card shadow-lg overflow-hidden max-h-40 overflow-y-auto">
                      {contactResults.map((c) => (
                        <button key={c.id} type="button"
                          onClick={() => { setLinkedContact(c); setContactSearch(""); setContactOpen(false); }}
                          className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-muted transition-colors">
                          <User className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Valid until</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tax rate (%)</label>
              <input type="number" min="0" max="100" step="0.1" value={taxRate}
                onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} className={numberCls} />
            </div>
            <div>
              <label className={labelCls}>Order discount</label>
              <div className="flex gap-1">
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value as "none"|"percent"|"fixed")}
                  className={cn(inputCls, "flex-shrink-0 w-auto")}>
                  <option value="none">None</option>
                  <option value="percent">%</option>
                  <option value="fixed">Fixed</option>
                </select>
                {discountType !== "none" && (
                  <input type="number" min="0" step="0.01" value={discountValue}
                    onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                    className={numberCls} />
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Any context for the customer…"
                className={cn(inputCls, "resize-none text-xs")} />
            </div>
            <div>
              <label className={labelCls}>Terms & conditions</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={5}
                className={cn(inputCls, "resize-none text-xs")} />
            </div>
          </div>

          {/* Right: line items table */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-medium">Line Items</span>
              <button onClick={addItem}
                className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {/* Column header */}
              <div className="grid items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                style={{ gridTemplateColumns: "2fr 6rem 8rem 6rem 7rem 2rem" }}>
                <span>Product / Description</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit Price</span>
                <span className="text-right">Disc %</span>
                <span className="text-right">Line Total</span>
                <span />
              </div>

              {items.map((item) => (
                <div key={item._key} className="relative">
                  <div className="grid items-start gap-2 rounded-lg border bg-background p-2"
                    style={{ gridTemplateColumns: "2fr 6rem 8rem 6rem 7rem 2rem" }}>

                    {/* Product name + picker */}
                    <div className="space-y-1">
                      <div className="relative">
                        <input
                          value={item.productName}
                          onChange={(e) => updateItem(item._key, { productName: e.target.value, productId: null })}
                          placeholder="Product name *"
                          className={cn(inputCls, "text-sm font-medium pr-7")}
                        />
                        <button
                          type="button"
                          onClick={() => { setPickerRow(pickerRow === item._key ? null : item._key); setPickerSearch(""); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          <Package className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {item.description !== undefined && (
                        <input
                          value={item.description ?? ""}
                          onChange={(e) => updateItem(item._key, { description: e.target.value })}
                          placeholder="Description (optional)"
                          className={cn(inputCls, "text-xs text-muted-foreground")}
                        />
                      )}
                    </div>

                    {/* Qty */}
                    <input type="number" min="0.001" step="1" value={item.quantity}
                      onChange={(e) => updateItem(item._key, { quantity: parseFloat(e.target.value) || 0 })}
                      className={numberCls} />

                    {/* Unit price */}
                    <input type="number" min="0" step="0.01" value={item.unitPrice}
                      onChange={(e) => updateItem(item._key, { unitPrice: parseFloat(e.target.value) || 0 })}
                      className={numberCls} />

                    {/* Discount % */}
                    <input type="number" min="0" max="100" step="0.5" value={item.discountPct}
                      onChange={(e) => updateItem(item._key, { discountPct: parseFloat(e.target.value) || 0 })}
                      className={cn(numberCls, item.discountPct > discountThreshold && "border-yellow-400 bg-yellow-50 text-yellow-800")} />

                    {/* Line total */}
                    <div className="flex items-center justify-end px-2 text-sm font-semibold">
                      {fmtCurrency(item.lineTotal, currency)}
                    </div>

                    {/* Remove */}
                    <button type="button" onClick={() => removeItem(item._key)}
                      disabled={items.length === 1}
                      className="self-center text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-30">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Product picker dropdown */}
                  {pickerRow === item._key && (
                    <div className="absolute top-full left-0 z-20 mt-1 w-80 rounded-xl border bg-card shadow-xl overflow-hidden">
                      <div className="p-2 border-b">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)}
                            placeholder="Search products…"
                            autoFocus
                            className={cn(inputCls, "pl-7 py-1.5 text-xs")} />
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {filteredProducts.length === 0
                          ? <p className="py-4 text-center text-xs text-muted-foreground">No products found</p>
                          : filteredProducts.map((p) => (
                            <button key={p.id} type="button"
                              onClick={() => {
                                updateItem(item._key, {
                                  productId:   p.id,
                                  productName: p.name,
                                  description: p.description ?? "",
                                  unitPrice:   p.unitPrice,
                                  discountPct: 0,
                                });
                                setPickerRow(null);
                              }}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted transition-colors">
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{p.name}</p>
                                {p.sku && <p className="text-xs text-muted-foreground">SKU: {p.sku}</p>}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-semibold">{fmtCurrency(p.unitPrice, p.currency)}</p>
                                <p className="text-xs text-muted-foreground">{BILLING_CYCLE_LABELS[p.billingCycle]}</p>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Totals footer */}
            <div className="shrink-0 border-t bg-muted/30 p-4">
              <div className="ml-auto w-64 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{fmtCurrency(totals.subtotal, currency)}</span>
                </div>
                {totals.orderDiscount > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Order discount</span>
                    <span>−{fmtCurrency(totals.orderDiscount, currency)}</span>
                  </div>
                )}
                {taxRate > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax ({taxRate}%)</span>
                    <span>{fmtCurrency(totals.tax, currency)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1.5 text-base font-bold">
                  <span>Total</span>
                  <span>{fmtCurrency(totals.total, currency)}</span>
                </div>
                {needsApproval && (
                  <p className="text-xs text-yellow-700 flex items-center gap-1 mt-1">
                    <Info className="h-3 w-3 shrink-0" />
                    Discount exceeds {discountThreshold}% — manager approval required
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t px-6 py-4 flex items-center gap-3">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          <div className="ml-auto flex gap-3">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !title.trim()}
              className={cn("rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground",
                (saving || !title.trim()) ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
              {saving ? "Saving…" : needsApproval ? "Submit for Approval" : isEdit ? "Save Quote" : "Create Quote"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
