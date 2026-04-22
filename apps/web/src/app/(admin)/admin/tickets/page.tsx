"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Ticket as TicketIcon, Search, RefreshCw, AlertCircle,
  ChevronRight, Filter,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUSES   = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const CATEGORIES = [
  "ORDER_ISSUE", "PAYMENT", "SHIPPING", "REFUND",
  "ACCOUNT", "LISTING", "FRAUD", "OTHER",
] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

type Status   = typeof STATUSES[number];
type Category = typeof CATEGORIES[number];
type Priority = typeof PRIORITIES[number];

interface Ticket {
  id: string;
  source: string;
  sourceTicketId: string;
  externalTicketId: string;
  subject: string;
  category: Category;
  priority: Priority;
  status: Status;
  orderId: string | null;
  sourceCreatedAt: string;
  createdAt: string;
}

const STATUS_COLORS: Record<Status, string> = {
  OPEN:        "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  RESOLVED:    "bg-green-100 text-green-700",
  CLOSED:      "bg-gray-100 text-gray-700",
};

const PRIORITY_COLORS: Record<Priority, string> = {
  LOW:    "bg-gray-100 text-gray-600",
  NORMAL: "bg-slate-100 text-slate-700",
  HIGH:   "bg-orange-100 text-orange-700",
  URGENT: "bg-red-100 text-red-700",
};

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus]     = useState<Status   | "all">("all");
  const [category, setCategory] = useState<Category | "all">("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [q, setQ]               = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status   !== "all") params.set("status", status);
      if (category !== "all") params.set("category", category);
      if (priority !== "all") params.set("priority", priority);
      if (q.trim())           params.set("q", q.trim());
      params.set("limit", "100");

      const res = await api.get(`/api/v1/tickets?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTickets(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (e: any) {
      setError(e.message ?? "Failed to load tickets");
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [status, category, priority, q]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TicketIcon className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Support tickets</h1>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {total}
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search subject or ticket ID…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm focus:border-primary focus:outline-none"
          />
        </div>

        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as Status | "all")}
          options={STATUSES}
        />
        <FilterSelect
          label="Category"
          value={category}
          onChange={(v) => setCategory(v as Category | "all")}
          options={CATEGORIES}
        />
        <FilterSelect
          label="Priority"
          value={priority}
          onChange={(v) => setPriority(v as Priority | "all")}
          options={PRIORITIES}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* List */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse p-4">
                <div className="h-4 w-2/3 rounded bg-muted" />
                <div className="mt-2 h-3 w-1/2 rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <TicketIcon className="h-10 w-10 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">No tickets match these filters</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Ticket</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Received</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/admin/tickets/${t.externalTicketId}`}
                      className="text-primary hover:underline"
                    >
                      {t.externalTicketId}
                    </Link>
                    <div className="text-[10px] text-muted-foreground">{t.source}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tickets/${t.externalTicketId}`}
                      className="block max-w-md truncate font-medium hover:underline"
                    >
                      {t.subject}
                    </Link>
                    {t.orderId && (
                      <div className="text-[11px] text-muted-foreground">
                        order {t.orderId}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {t.category.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", PRIORITY_COLORS[t.priority])}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_COLORS[t.status])}>
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatTime(t.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/tickets/${t.externalTicketId}`}
                      className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Filter className="h-3.5 w-3.5" />
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
      >
        <option value="all">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>
        ))}
      </select>
    </label>
  );
}
