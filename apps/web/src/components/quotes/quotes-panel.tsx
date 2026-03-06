"use client";

/**
 * QuotesPanel — embeddable tab/section showing quotes for a deal, company, or contact.
 * Used inside Opportunity detail, Company detail, Contact detail, Lead detail.
 */
import { useState, useEffect, useCallback } from "react";
import {
  FileText, Plus, Download, Send, Check, X, Clock,
  Eye, ThumbsUp, ThumbsDown, AlertCircle, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  DEMO_PRODUCTS, fmtCurrency, STATUS_COLORS, STATUS_LABELS,
  type Quote, type Product,
} from "@/lib/quotes";
import { QuoteBuilderModal } from "@/components/modals/quote-builder-modal";
import { generateQuotePDF } from "@/lib/quote-pdf";

// ── Demo quotes for when API is unavailable ───────────────────────────────────
function buildDemoQuotes(dealId?: string, companyId?: string, contactId?: string): Quote[] {
  const base = {
    createdBy: "user-admin", createdByName: "Admin User",
    currency: "GBP", discountType: "none" as const, discountValue: 0,
    taxRate: 0, notes: null, terms: null, approvalRequired: false,
    approvedBy: null, approvedAt: null, sentAt: null, viewedAt: null,
    acceptedAt: null, rejectedAt: null, dealId: dealId ?? null,
    companyId: companyId ?? null, contactId: contactId ?? null,
    updatedAt: new Date().toISOString(),
  };
  return [
    {
      ...base,
      id: "demo-q-001", quoteNumber: "Q-2026-0012", title: "CRM Pro — 5 seats (annual)",
      status: "accepted" as const, subtotal: 4450, total: 4450,
      validUntil: "2026-04-01", createdAt: "2026-02-15T10:00:00Z",
      items: [
        { productName: "CRM Pro — Annual", quantity: 5, unitPrice: 890, discountPct: 0, lineTotal: 4450 },
      ],
    },
    {
      ...base,
      id: "demo-q-002", quoteNumber: "Q-2026-0021", title: "Enterprise upgrade + Implementation",
      status: "sent" as const, subtotal: 14950, total: 14950,
      validUntil: "2026-04-30", createdAt: "2026-03-01T09:00:00Z",
      items: [
        { productName: "CRM Enterprise — Annual", quantity: 5, unitPrice: 1490, discountPct: 0, lineTotal: 7450 },
        { productName: "Implementation — Standard", quantity: 1, unitPrice: 4500, discountPct: 0, lineTotal: 4500 },
        { productName: "Training — Half Day", quantity: 1, unitPrice: 1200, discountPct: 0, lineTotal: 1200 },
        { productName: "Premium Support", quantity: 3, unitPrice: 250, discountPct: 0, lineTotal: 750 },
      ],
    },
  ];
}

interface Props {
  dealId?:      string;
  dealName?:    string;
  companyId?:   string;
  companyName?: string;
  contactId?:   string;
  contactName?: string;
  currency?:    string;
  canQuote?:    boolean; // from user permissions
}

export function QuotesPanel({ dealId, dealName, companyId, companyName, contactId, contactName, currency = "GBP", canQuote = true }: Props) {
  const [quotes,      setQuotes]      = useState<Quote[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editQuote,   setEditQuote]   = useState<Quote | null>(null);
  const [expanded,    setExpanded]    = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchQuotes = useCallback(async () => {
    const params = new URLSearchParams();
    if (dealId)    params.set("dealId",    dealId);
    if (companyId) params.set("companyId", companyId);
    if (contactId) params.set("contactId", contactId);

    try {
      const res  = await api.get(`/api/v1/quotes?${params}`);
      const json = await res.json();
      setQuotes(json.data?.length ? json.data : buildDemoQuotes(dealId, companyId, contactId));
    } catch {
      setQuotes(buildDemoQuotes(dealId, companyId, contactId));
    } finally { setLoading(false); }
  }, [dealId, companyId, contactId]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const handleSaved = (q: Quote) => {
    setQuotes((prev) => {
      const idx = prev.findIndex((x) => x.id === q.id);
      return idx >= 0 ? prev.map((x) => x.id === q.id ? q : x) : [q, ...prev];
    });
  };

  const handleSend = async (id: string) => {
    setActionLoading(id + "-send");
    try {
      await api.post(`/api/v1/quotes/${id}/send`, {});
      setQuotes((prev) => prev.map((q) => q.id === id ? { ...q, status: "sent", sentAt: new Date().toISOString() } : q));
    } catch { /* silent */ }
    finally { setActionLoading(null); }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id + "-approve");
    try {
      await api.post(`/api/v1/quotes/${id}/approve`, {});
      setQuotes((prev) => prev.map((q) => q.id === id ? { ...q, status: "draft", approvalRequired: false, approvedAt: new Date().toISOString() } : q));
    } catch { /* silent */ }
    finally { setActionLoading(null); }
  };

  const handleDownloadPDF = async (q: Quote) => {
    await generateQuotePDF(q);
  };

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading quotes…</div>;

  return (
    <div className="space-y-3">
      {(showBuilder || editQuote) && (
        <QuoteBuilderModal
          dealId={dealId} dealName={dealName}
          companyId={companyId} companyName={companyName}
          contactId={contactId} contactName={contactName}
          existing={editQuote ?? undefined}
          onClose={() => { setShowBuilder(false); setEditQuote(null); }}
          onSaved={(q) => { handleSaved(q); setShowBuilder(false); setEditQuote(null); }}
        />
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{quotes.length} quote{quotes.length !== 1 ? "s" : ""}</p>
        {canQuote && (
          <button onClick={() => setShowBuilder(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> New Quote
          </button>
        )}
      </div>

      {quotes.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No quotes yet</p>
          {canQuote && (
            <button onClick={() => setShowBuilder(true)}
              className="text-sm font-medium text-primary hover:underline">
              Create the first quote
            </button>
          )}
        </div>
      )}

      {quotes.map((q) => (
        <div key={q.id} className="rounded-xl border bg-card overflow-hidden">
          {/* Summary row */}
          <div
            className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
            onClick={() => setExpanded((e) => e === q.id ? null : q.id)}>
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">{q.quoteNumber}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[q.status])}>
                  {STATUS_LABELS[q.status]}
                </span>
              </div>
              <p className="text-sm font-medium truncate">{q.title}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold">{fmtCurrency(q.total, q.currency)}</p>
              {q.validUntil && (
                <p className="text-xs text-muted-foreground">
                  Valid to {new Date(q.validUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </p>
              )}
            </div>
            <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded === q.id && "rotate-90")} />
          </div>

          {/* Expanded detail */}
          {expanded === q.id && (
            <div className="border-t bg-muted/10 px-4 pb-4 pt-3 space-y-3">
              {/* Line items */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground uppercase">
                    <th className="text-left pb-1.5 font-medium">Product</th>
                    <th className="text-right pb-1.5 font-medium">Qty</th>
                    <th className="text-right pb-1.5 font-medium">Unit</th>
                    <th className="text-right pb-1.5 font-medium">Disc</th>
                    <th className="text-right pb-1.5 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {q.items.map((it, i) => (
                    <tr key={i} className="text-sm">
                      <td className="py-1.5 font-medium">{it.productName}{it.description && <p className="text-xs text-muted-foreground font-normal">{it.description}</p>}</td>
                      <td className="py-1.5 text-right">{it.quantity}</td>
                      <td className="py-1.5 text-right">{fmtCurrency(it.unitPrice, q.currency)}</td>
                      <td className="py-1.5 text-right">{it.discountPct > 0 ? `${it.discountPct}%` : "—"}</td>
                      <td className="py-1.5 text-right font-semibold">{fmtCurrency(it.lineTotal, q.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-48 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span><span>{fmtCurrency(q.subtotal, q.currency)}</span>
                  </div>
                  {q.taxRate > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax ({q.taxRate}%)</span>
                      <span>{fmtCurrency(q.total - q.subtotal, q.currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t pt-1">
                    <span>Total</span><span>{fmtCurrency(q.total, q.currency)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {q.notes && (
                <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Notes: </span>{q.notes}
                </div>
              )}

              {/* Approval notice */}
              {q.status === "pending_approval" && (
                <div className="flex items-center justify-between rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-yellow-800">
                    <Clock className="h-4 w-4" />
                    Awaiting manager approval before this quote can be sent
                  </div>
                  <button onClick={() => handleApprove(q.id)}
                    disabled={actionLoading === q.id + "-approve"}
                    className="flex items-center gap-1 rounded-md bg-yellow-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-yellow-700 disabled:opacity-60">
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {canQuote && ["draft","pending_approval"].includes(q.status) && (
                  <button onClick={() => setEditQuote(q)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                    Edit
                  </button>
                )}
                {canQuote && q.status === "draft" && (
                  <button onClick={() => handleSend(q.id)} disabled={actionLoading === q.id + "-send"}
                    className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
                    <Send className="h-3 w-3" /> Send
                  </button>
                )}
                <button onClick={() => handleDownloadPDF(q)}
                  className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                  <Download className="h-3 w-3" /> PDF
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
