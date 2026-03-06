"use client";

import { useState, useEffect } from "react";
import {
  FileText, Plus, Download, Search, Filter,
  CheckCircle2, Clock, Send, Eye, ThumbsDown,
  TrendingUp, DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  STATUS_COLORS, STATUS_LABELS, fmtCurrency,
  type Quote, type QuoteStatus,
} from "@/lib/quotes";
import { QuoteBuilderModal } from "@/components/modals/quote-builder-modal";
import { generateQuotePDF } from "@/lib/quote-pdf";
import { ActionBar } from "@/components/action-bar/action-bar";

// ── Demo data ─────────────────────────────────────────────────────────────────
const DEMO_QUOTES: Quote[] = [
  {
    id: "q-001", quoteNumber: "Q-2026-0012", title: "Acme Corp — CRM Pro 5 seats",
    status: "accepted", approvalRequired: false, currency: "GBP",
    subtotal: 4450, discountType: "none", discountValue: 0, taxRate: 0, total: 4450,
    dealId: null, companyId: "c-001", contactId: null, createdBy: "u-001",
    createdByName: "Sarah Kim", companyName: "Acme Corp",
    validUntil: "2026-04-01", notes: null, terms: null,
    sentAt: "2026-02-16T10:00:00Z", viewedAt: "2026-02-17T14:00:00Z",
    acceptedAt: "2026-02-20T09:00:00Z", rejectedAt: null,
    approvedBy: null, approvedAt: null,
    createdAt: "2026-02-15T10:00:00Z", updatedAt: "2026-02-20T09:00:00Z",
    items: [{ productName: "CRM Pro — Annual", quantity: 5, unitPrice: 890, discountPct: 0, lineTotal: 4450 }],
  },
  {
    id: "q-002", quoteNumber: "Q-2026-0021", title: "TechStart — Enterprise upgrade",
    status: "sent", approvalRequired: false, currency: "GBP",
    subtotal: 14950, discountType: "none", discountValue: 0, taxRate: 0, total: 14950,
    dealId: null, companyId: "c-002", contactId: null, createdBy: "u-001",
    createdByName: "Marcus Chen", companyName: "TechStart",
    validUntil: "2026-04-30", notes: null, terms: null,
    sentAt: "2026-03-01T09:00:00Z", viewedAt: null, acceptedAt: null, rejectedAt: null,
    approvedBy: null, approvedAt: null,
    createdAt: "2026-03-01T08:00:00Z", updatedAt: "2026-03-01T09:00:00Z",
    items: [
      { productName: "CRM Enterprise — Annual", quantity: 5, unitPrice: 1490, discountPct: 0, lineTotal: 7450 },
      { productName: "Implementation — Standard", quantity: 1, unitPrice: 4500, discountPct: 0, lineTotal: 4500 },
      { productName: "Training — Half Day", quantity: 1, unitPrice: 1200, discountPct: 0, lineTotal: 1200 },
      { productName: "Premium Support", quantity: 3, unitPrice: 250, discountPct: 0, lineTotal: 750 },
    ],
  },
  {
    id: "q-003", quoteNumber: "Q-2026-0029", title: "Globex — Standard plan draft",
    status: "pending_approval", approvalRequired: true, currency: "GBP",
    subtotal: 5340, discountType: "percent", discountValue: 15, taxRate: 0, total: 4539,
    dealId: null, companyId: "c-003", contactId: null, createdBy: "u-002",
    createdByName: "Priya Sharma", companyName: "Globex",
    validUntil: "2026-05-01", notes: "15% first-year discount offered by sales director",
    terms: null, sentAt: null, viewedAt: null, acceptedAt: null, rejectedAt: null,
    approvedBy: null, approvedAt: null,
    createdAt: "2026-03-04T11:00:00Z", updatedAt: "2026-03-04T11:00:00Z",
    items: [
      { productName: "CRM Pro — Annual", quantity: 6, unitPrice: 890, discountPct: 15, lineTotal: 4539 },
    ],
  },
  {
    id: "q-004", quoteNumber: "Q-2026-0031", title: "Initech — Renewal 2026",
    status: "draft", approvalRequired: false, currency: "GBP",
    subtotal: 8900, discountType: "none", discountValue: 0, taxRate: 0, total: 8900,
    dealId: null, companyId: "c-004", contactId: null, createdBy: "u-001",
    createdByName: "Alex Johnson", companyName: "Initech",
    validUntil: "2026-04-15", notes: null, terms: null,
    sentAt: null, viewedAt: null, acceptedAt: null, rejectedAt: null,
    approvedBy: null, approvedAt: null,
    createdAt: "2026-03-05T15:00:00Z", updatedAt: "2026-03-05T15:00:00Z",
    items: [{ productName: "CRM Pro — Annual", quantity: 10, unitPrice: 890, discountPct: 0, lineTotal: 8900 }],
  },
];

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "",                 label: "All statuses" },
  { value: "draft",            label: "Draft" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "sent",             label: "Sent" },
  { value: "viewed",           label: "Viewed" },
  { value: "accepted",         label: "Accepted" },
  { value: "rejected",         label: "Rejected" },
  { value: "expired",          label: "Expired" },
];

export default function QuotesPage() {
  const [quotes,      setQuotes]      = useState<Quote[]>(DEMO_QUOTES);
  const [loading,     setLoading]     = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editQuote,   setEditQuote]   = useState<Quote | null>(null);
  const [search,      setSearch]      = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    api.get("/api/v1/quotes")
      .then((r) => r.json())
      .then((j) => { if (j.data?.length) setQuotes(j.data); })
      .catch(() => { /* use demo data */ })
      .finally(() => setLoading(false));
  }, []);

  const handleSaved = (q: Quote) => {
    setQuotes((prev) => {
      const idx = prev.findIndex((x) => x.id === q.id);
      return idx >= 0 ? prev.map((x) => x.id === q.id ? q : x) : [q, ...prev];
    });
  };

  const handleSend = async (id: string) => {
    try {
      await api.post(`/api/v1/quotes/${id}/send`, {});
      setQuotes((prev) => prev.map((q) => q.id === id ? { ...q, status: "sent" as QuoteStatus, sentAt: new Date().toISOString() } : q));
    } catch { /* silent */ }
  };

  const handleApprove = async (id: string) => {
    try {
      await api.post(`/api/v1/quotes/${id}/approve`, {});
      setQuotes((prev) => prev.map((q) => q.id === id ? { ...q, status: "draft" as QuoteStatus, approvalRequired: false } : q));
    } catch { /* silent */ }
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

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Quotes</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{quotes.length}</span>
          <ActionBar context="quotes" />
        </div>
        <button onClick={() => setShowBuilder(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New Quote
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Won (accepted)", value: fmtCurrency(totalAccepted, "GBP"), icon: CheckCircle2, color: "bg-green-100 text-green-700" },
          { label: "In pipeline",    value: fmtCurrency(totalPending,  "GBP"), icon: TrendingUp,   color: "bg-blue-100 text-blue-700" },
          { label: "Win rate",       value: `${winRate}%`,                      icon: DollarSign,   color: "bg-purple-100 text-purple-700" },
          { label: "Awaiting approval", value: String(awaitingApproval),        icon: Clock,        color: "bg-yellow-100 text-yellow-700" },
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
            placeholder="Search quotes, companies…"
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
            <strong>{awaitingApproval}</strong> quote{awaitingApproval !== 1 ? "s" : ""} pending manager approval
          </div>
          <button onClick={() => setStatusFilter("pending_approval")}
            className="text-xs font-medium text-yellow-700 hover:underline">
            View all →
          </button>
        </div>
      )}

      {/* Quotes table */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No quotes match your filters</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["Quote #", "Title", "Company", "Status", "Total", "Valid Until", "Rep", "Actions"].map((h) => (
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
                      <p className="text-xs text-muted-foreground truncate">{q.items.length} line item{q.items.length !== 1 ? "s" : ""}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{q.companyName ?? "—"}</td>
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
                      {["draft","pending_approval"].includes(q.status) && (
                        <button onClick={() => setEditQuote(q)} title="Edit"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground text-xs">
                          Edit
                        </button>
                      )}
                      {q.status === "draft" && (
                        <button onClick={() => handleSend(q.id)} title="Send"
                          className="rounded p-1 text-blue-600 hover:bg-blue-50 text-xs">
                          Send
                        </button>
                      )}
                      {q.status === "pending_approval" && (
                        <button onClick={() => handleApprove(q.id)} title="Approve"
                          className="rounded p-1 text-yellow-700 hover:bg-yellow-50 text-xs">
                          Approve
                        </button>
                      )}
                      <button onClick={() => generateQuotePDF(q)} title="Download PDF"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Download className="h-3.5 w-3.5" />
                      </button>
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
