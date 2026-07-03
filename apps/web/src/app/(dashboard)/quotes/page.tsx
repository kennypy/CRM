"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  FileText, Plus, Download, Search, Filter,
  CheckCircle2, Clock, Send, Eye, ThumbsDown,
  TrendingUp, DollarSign, X, Pencil, Trash2, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  STATUS_COLORS, STATUS_LABELS, fmtCurrency, computeQuoteTotals,
  type Quote, type QuoteStatus,
} from "@/lib/quotes";
import { QuoteBuilderModal } from "@/components/modals/quote-builder-modal";
import { generateQuotePDF } from "@/lib/quote-pdf";

function useStatusFilterOptions() {
  const t = useTranslations("quotes");
  return [
    { value: "",                 label: t("allStatuses") },
    { value: "draft",            label: t("draft") },
    { value: "pending_approval", label: t("pendingApproval") },
    { value: "sent",             label: t("sent") },
    { value: "viewed",           label: t("viewed") },
    { value: "accepted",         label: t("accepted") },
    { value: "rejected",         label: t("rejected") },
    { value: "expired",          label: t("expired") },
  ];
}

// ── In-browser quote preview ──────────────────────────────────────────────────

function QuotePreviewModal({
  quote,
  onClose,
  onEdit,
}: {
  quote: Quote;
  onClose: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const totals = computeQuoteTotals(quote.items, quote.discountType, quote.discountValue, quote.taxRate);
  const canEdit = ["draft", "pending_approval"].includes(quote.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-3xl flex-col rounded-2xl border bg-card shadow-2xl" style={{ maxHeight: "92vh" }}>
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b px-6 py-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="font-mono text-xs text-muted-foreground">{quote.quoteNumber}</span>
              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[quote.status])}>
                {STATUS_LABELS[quote.status]}
              </span>
            </div>
            <h2 className="text-lg font-semibold">{quote.title}</h2>
            <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
              {quote.companyName && <span>Company: <strong className="text-foreground">{quote.companyName}</strong></span>}
              {quote.createdByName && <span>Rep: <strong className="text-foreground">{quote.createdByName}</strong></span>}
              {quote.relatedTo && <span>Related to: <strong className="text-foreground">{quote.relatedTo}</strong></span>}
              {quote.validUntil && <span>Valid until: <strong className="text-foreground">{new Date(quote.validUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong></span>}
            </div>
          </div>
          <button onClick={onClose} className="ml-4 shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Line items */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr>
                {[t("productDescription"), t("qty"), t("unitPrice"), t("discPercent"), t("lineTotal")].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground last:text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quote.items.map((item, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <p className="font-medium">{item.productName}</p>
                    {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{item.quantity}</td>
                  <td className="px-4 py-3 tabular-nums">{fmtCurrency(item.unitPrice, quote.currency)}</td>
                  <td className="px-4 py-3 tabular-nums">{item.discountPct > 0 ? `${item.discountPct}%` : "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtCurrency(item.lineTotal, quote.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="border-t bg-muted/20 px-6 py-4">
            <div className="ml-auto w-56 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>{t("subtotal")}</span><span>{fmtCurrency(totals.subtotal, quote.currency)}</span>
              </div>
              {totals.orderDiscount > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>{t("discount")}</span><span>−{fmtCurrency(totals.orderDiscount, quote.currency)}</span>
                </div>
              )}
              {quote.taxRate > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("tax", { rate: quote.taxRate })}</span><span>{fmtCurrency(totals.tax, quote.currency)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-1.5 text-base font-bold">
                <span>{tc("total")}</span><span>{fmtCurrency(totals.total, quote.currency)}</span>
              </div>
            </div>
          </div>

          {/* Notes / Terms */}
          {(quote.notes || quote.terms) && (
            <div className="border-t px-6 py-4 space-y-3">
              {quote.notes && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{tc("notes")}</p>
                  <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
                </div>
              )}
              {quote.terms && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{t("termsConditions")}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.terms}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">{tc("close")}</button>
          <div className="flex gap-2">
            {canEdit && (
              <button onClick={onEdit}
                className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                <Pencil className="h-3.5 w-3.5" /> {tc("edit")}
              </button>
            )}
            <button onClick={() => generateQuotePDF(quote)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Download className="h-3.5 w-3.5" /> {t("downloadPdf")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QuotesPage() {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const STATUS_FILTER_OPTIONS = useStatusFilterOptions();
  const [quotes,       setQuotes]       = useState<Quote[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [showBuilder,  setShowBuilder]  = useState(false);
  const [editQuote,    setEditQuote]    = useState<Quote | null>(null);
  const [viewQuote,    setViewQuote]    = useState<Quote | null>(null);
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/api/v1/quotes");
      if (!res.ok) throw new Error(`Failed to load quotes (${res.status})`);
      const json = await res.json();
      setQuotes(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quotes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const handleSaved = (q: Quote) => {
    setQuotes((prev) => {
      const idx = prev.findIndex((x) => x.id === q.id);
      return idx >= 0 ? prev.map((x) => x.id === q.id ? q : x) : [q, ...prev];
    });
    // Also update the preview modal if the saved quote is currently being viewed
    if (viewQuote?.id === q.id) setViewQuote(q);
  };

  const handleSend = async (id: string) => {
    try {
      const res = await api.post(`/api/v1/quotes/${id}/send`, {});
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? "Failed to send quote");
      }
      setQuotes((prev) => prev.map((q) => q.id === id ? { ...q, status: "sent" as QuoteStatus, sentAt: new Date().toISOString() } : q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send quote");
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const res = await api.post(`/api/v1/quotes/${id}/approve`, {});
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? "Failed to approve quote");
      }
      setQuotes((prev) => prev.map((q) => q.id === id ? { ...q, status: "draft" as QuoteStatus, approvalRequired: false } : q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve quote");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this quote? This cannot be undone.")) return;
    try {
      const res = await api.delete(`/api/v1/quotes/${id}`);
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? "Failed to delete quote");
      }
      setQuotes((prev) => prev.filter((q) => q.id !== id));
      if (viewQuote?.id === id) setViewQuote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete quote");
    }
  };

  const filtered = quotes.filter((q) => {
    const matchSearch = !search || q.title.toLowerCase().includes(search.toLowerCase()) ||
      q.quoteNumber.toLowerCase().includes(search.toLowerCase()) ||
      (q.companyName ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || q.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // KPIs
  const totalAccepted = quotes.filter((q) => q.status === "accepted").reduce((s, q) => s + q.total, 0);
  const totalPending  = quotes.filter((q) => ["sent","viewed"].includes(q.status)).reduce((s, q) => s + q.total, 0);
  const winRate       = quotes.filter((q) => ["accepted","rejected"].includes(q.status)).length > 0
    ? Math.round(quotes.filter((q) => q.status === "accepted").length /
        quotes.filter((q) => ["accepted","rejected"].includes(q.status)).length * 100)
    : 0;
  const awaitingApproval = quotes.filter((q) => q.status === "pending_approval").length;

  const STATUS_ICON: Record<string, React.ReactNode> = {
    draft:            <FileText className="h-4 w-4 text-gray-400" />,
    pending_approval: <Clock className="h-4 w-4 text-yellow-500" />,
    sent:             <Send className="h-4 w-4 text-blue-500" />,
    viewed:           <Eye className="h-4 w-4 text-purple-500" />,
    accepted:         <CheckCircle2 className="h-4 w-4 text-green-600" />,
    rejected:         <ThumbsDown className="h-4 w-4 text-red-500" />,
    expired:          <Clock className="h-4 w-4 text-orange-500" />,
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto">
      {(showBuilder || editQuote) && (
        <QuoteBuilderModal
          existing={editQuote ?? undefined}
          onClose={() => { setShowBuilder(false); setEditQuote(null); }}
          onSaved={(q) => { handleSaved(q); setShowBuilder(false); setEditQuote(null); }}
        />
      )}
      {viewQuote && (
        <QuotePreviewModal
          quote={viewQuote}
          onClose={() => setViewQuote(null)}
          onEdit={() => { setEditQuote(viewQuote); setViewQuote(null); }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{quotes.length}</span>
        </div>
        <button onClick={() => setShowBuilder(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> {t("newQuote")}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: t("wonAccepted"), value: fmtCurrency(totalAccepted, "GBP"), icon: CheckCircle2, color: "bg-green-100 text-green-700" },
          { label: t("inPipeline"),    value: fmtCurrency(totalPending,  "GBP"), icon: TrendingUp,   color: "bg-blue-100 text-blue-700" },
          { label: t("winRate"),       value: `${winRate}%`,                      icon: DollarSign,   color: "bg-purple-100 text-purple-700" },
          { label: t("awaitingApproval"), value: String(awaitingApproval),        icon: Clock,        color: "bg-yellow-100 text-yellow-700" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{label}</p>
              <div className={cn("rounded-lg p-1.5", color)}><Icon className="h-4 w-4" /></div>
            </div>
            <p className="mt-1.5 text-xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none">
          {STATUS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Approval alerts */}
      {awaitingApproval > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-yellow-800">
            <Clock className="h-4 w-4" />
            {t("pendingApprovalBanner", { count: awaitingApproval })}
          </div>
          <button onClick={() => setStatusFilter("pending_approval")}
            className="text-xs font-medium text-yellow-700 hover:underline">
            {t("viewAllArrow")}
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Quotes table */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mb-3" />
          <p className="text-sm text-muted-foreground">{t("loadingQuotes")}</p>
        </div>
      ) : error && quotes.length === 0 ? (
        <div className="py-16 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-400 mb-3" />
          <p className="text-sm text-muted-foreground mb-3">{t("loadError")}</p>
          <button onClick={fetchQuotes}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            {tc("retry")}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {quotes.length === 0 ? t("emptyState") : t("noMatch")}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {[t("quoteNumber"), tc("title"), t("company"), t("contact"), tc("status"), t("total"), t("validUntil"), t("rep"), tc("actions")].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {filtered.map((q) => (
                <tr key={q.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{q.quoteNumber}</td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="font-medium truncate">{q.title}</p>
                    {q.items.length > 0 && (
                      <p className="text-xs text-muted-foreground truncate">{t("lineItems", { count: q.items.length })}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{q.companyName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{q.contactName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[q.status])}>
                      {STATUS_ICON[q.status]}
                      {STATUS_LABELS[q.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">{fmtCurrency(q.total, q.currency)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{q.createdByName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setViewQuote(q)} title={t("viewQuote")}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {["draft","pending_approval"].includes(q.status) && (
                        <button onClick={() => setEditQuote(q)} title={tc("edit")}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground text-xs">
                          {tc("edit")}
                        </button>
                      )}
                      {q.status === "draft" && (
                        <button onClick={() => handleSend(q.id)} title={t("sendQuote")}
                          className="rounded p-1 text-blue-600 hover:bg-blue-50 text-xs">
                          {t("sendQuote")}
                        </button>
                      )}
                      {q.status === "pending_approval" && (
                        <button onClick={() => handleApprove(q.id)} title={t("approve")}
                          className="rounded p-1 text-yellow-700 hover:bg-yellow-50 text-xs">
                          {t("approve")}
                        </button>
                      )}
                      <button onClick={() => generateQuotePDF(q)} title={t("downloadPdf")}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      {["draft","pending_approval"].includes(q.status) && (
                        <button onClick={() => handleDelete(q.id)} title={tc("delete")}
                          className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
