"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  TrendingUp, Search, RefreshCw, AlertCircle, Plus,
  ChevronLeft, ChevronRight, Flame, Minus, Snowflake,
  ArrowRight, Building2, Mail,
} from "lucide-react";

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  company?: { id: string; name: string };
  score: number;          // 0–100
  tier: "hot" | "warm" | "cold";
  source: string;         // "inbound" | "outbound" | "referral" | "auto"
  lastActivityAt?: string;
  createdAt: string;
}

function TierBadge({ tier }: { tier: string }) {
  const cfg: Record<string, { label: string; icon: React.FC<{ className?: string }>; cls: string }> = {
    hot:  { label: "Hot",  icon: Flame,     cls: "bg-red-100 text-red-700" },
    warm: { label: "Warm", icon: Minus,     cls: "bg-yellow-100 text-yellow-700" },
    cold: { label: "Cold", icon: Snowflake, cls: "bg-blue-100 text-blue-700" },
  };
  const { label, icon: Icon, cls } = cfg[tier] ?? cfg.cold;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-red-500" : score >= 40 ? "bg-yellow-500" : "bg-blue-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{score}</span>
    </div>
  );
}

const PAGE_SIZE = 50;

export default function LeadsPage() {
  const [leads, setLeads]         = useState<Lead[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState("");
  const [debounced, setDebounced] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (v: string) => {
    setSearch(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setDebounced(v); setPage(1); }, 300);
  };

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
      if (debounced) params.set("search", debounced);
      // Leads are contacts with lead_stage set — use contacts endpoint with type filter
      const res = await api.get(`/api/v1/contacts?${params}&isLead=true`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Enrich with score from scoring endpoint (batch mock for now)
      const raw: Lead[] = (json.data ?? []).map((c: any) => ({
        id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email,
        title: c.title, company: c.company,
        score: Math.floor(Math.random() * 60) + 20,
        tier: "warm" as const,
        source: c.source ?? "auto",
        lastActivityAt: c.lastActivityAt,
        createdAt: c.createdAt,
      }));
      setLeads(raw);
      setTotal(json.pagination?.total ?? raw.length);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, debounced]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const filtered = tierFilter === "all" ? leads : leads.filter((l) => l.tier === tierFilter);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const stats = {
    hot:  leads.filter((l) => l.tier === "hot").length,
    warm: leads.filter((l) => l.tier === "warm").length,
    cold: leads.filter((l) => l.tier === "cold").length,
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Leads</h1>
          {!loading && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{total.toLocaleString()}</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={fetchLeads} disabled={loading} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Add Lead
          </button>
        </div>
      </div>

      {/* Tier summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: "hot",  label: "Hot",  icon: Flame,     color: "text-red-600",    bg: "bg-red-50",    val: stats.hot },
          { key: "warm", label: "Warm", icon: Minus,     color: "text-yellow-600", bg: "bg-yellow-50", val: stats.warm },
          { key: "cold", label: "Cold", icon: Snowflake, color: "text-blue-600",   bg: "bg-blue-50",   val: stats.cold },
        ].map(({ key, label, icon: Icon, color, bg, val }) => (
          <button
            key={key}
            onClick={() => setTierFilter(tierFilter === key as any ? "all" : key as any)}
            className={cn("rounded-lg border p-4 text-left transition-all hover:shadow-sm", tierFilter === key ? `${bg} border-current` : "bg-card")}
          >
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4", color)} />
              <span className="text-sm font-medium">{label}</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{val}</p>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search leads…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              {["Lead", "Company", "Score", "Tier", "Source", "Last Activity", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 w-3/4 rounded bg-muted" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  {debounced ? "No leads match your search" : "No leads yet — connect an inbox to auto-capture"}
                </td>
              </tr>
            ) : (
              filtered.map((lead) => (
                <tr key={lead.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{lead.firstName} {lead.lastName}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" />{lead.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {lead.company ? (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" />{lead.company.name}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3"><ScoreBar score={lead.score} /></td>
                  <td className="px-4 py-3"><TierBadge tier={lead.tier} /></td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{lead.source}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.lastActivityAt ? formatRelativeTime(lead.lastActivityAt) : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <button className="flex items-center gap-1 text-xs text-primary hover:underline">
                      Convert <ArrowRight className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading} className="flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading} className="flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
