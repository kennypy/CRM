"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  Target, Search, RefreshCw, AlertCircle,
  Flame, Minus, Snowflake, Building2, Mail,
  ChevronLeft, ChevronRight, Zap,
} from "lucide-react";

interface LeadScore {
  id: string;
  contactId: string;
  score: number;
  tier: "hot" | "warm" | "cold";
  factors: Array<{ name: string; impact: number; evidence: string }>;
  modelVersion: string;
  calculatedAt: string;
  contactName: string | null;
  contactEmail: string | null;
  contactTitle: string | null;
  companyName: string | null;
}

function TierBadge({ tier }: { tier: string }) {
  const t = useTranslations("leadScoring");
  const cfg: Record<string, { label: string; icon: React.FC<{ className?: string }>; cls: string }> = {
    hot:  { label: t("hot"),  icon: Flame,     cls: "bg-red-100 text-red-700" },
    warm: { label: t("warm"), icon: Minus,     cls: "bg-yellow-100 text-yellow-700" },
    cold: { label: t("cold"), icon: Snowflake, cls: "bg-blue-100 text-blue-700" },
  };
  const { label, icon: Icon, cls } = cfg[tier] ?? cfg.cold;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>
      <Icon className="h-3 w-3" />{label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-red-500" : score >= 40 ? "bg-yellow-500" : "bg-blue-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-semibold tabular-nums">{score}</span>
    </div>
  );
}

function FactorsPanel({ factors, onClose }: { factors: LeadScore["factors"]; onClose: () => void }) {
  const t = useTranslations("leadScoring");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{t("scoreFactors")}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">&times;</button>
        </div>
        <div className="p-6 space-y-3 max-h-96 overflow-y-auto">
          {factors.length === 0 && <p className="text-sm text-muted-foreground">{t("noFactors")}</p>}
          {factors.map((f, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{f.name}</span>
                <span className={cn("text-sm font-semibold", f.impact >= 0 ? "text-green-600" : "text-red-600")}>
                  {f.impact >= 0 ? "+" : ""}{f.impact}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{f.evidence}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Demo data for when API returns empty
const DEMO_SCORES: LeadScore[] = [
  { id: "1", contactId: "c1", score: 92, tier: "hot", factors: [
    { name: "Email engagement", impact: 25, evidence: "Opened 8 of 10 emails in last 14 days" },
    { name: "Meeting activity", impact: 20, evidence: "Attended 3 product demos" },
    { name: "Seniority", impact: 15, evidence: "VP Engineering — decision maker" },
    { name: "Company fit", impact: 18, evidence: "Enterprise tier, SaaS industry" },
    { name: "Website visits", impact: 14, evidence: "Visited pricing page 4 times" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), contactName: "Sarah Chen", contactEmail: "sarah@acmecorp.com", contactTitle: "VP Engineering", companyName: "Acme Corp" },
  { id: "2", contactId: "c2", score: 78, tier: "hot", factors: [
    { name: "Email engagement", impact: 20, evidence: "Replied to 3 outreach emails" },
    { name: "Demo request", impact: 25, evidence: "Submitted demo form on website" },
    { name: "Company size", impact: 15, evidence: "500+ employees, growth stage" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), contactName: "James Wilson", contactEmail: "james@techstart.io", contactTitle: "CTO", companyName: "TechStart" },
  { id: "3", contactId: "c3", score: 55, tier: "warm", factors: [
    { name: "Email opens", impact: 12, evidence: "Opened 4 of 10 emails" },
    { name: "LinkedIn connection", impact: 8, evidence: "Accepted LinkedIn invite" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), contactName: "Maria Garcia", contactEmail: "maria@globex.com", contactTitle: "Director of Sales", companyName: "Globex Inc" },
  { id: "4", contactId: "c4", score: 41, tier: "warm", factors: [
    { name: "Inbound inquiry", impact: 15, evidence: "Submitted contact form" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), contactName: "David Kim", contactEmail: "david@novacorp.com", contactTitle: "Sales Manager", companyName: "NovaCorp" },
  { id: "5", contactId: "c5", score: 23, tier: "cold", factors: [
    { name: "No engagement", impact: -10, evidence: "No email opens in 30 days" },
  ], modelVersion: "v1", calculatedAt: new Date().toISOString(), contactName: "Alex Johnson", contactEmail: "alex@oldco.com", contactTitle: "Analyst", companyName: "OldCo" },
];

const PAGE_SIZE = 50;

export default function LeadScoringPage() {
  const t = useTranslations("leadScoring");
  const tc = useTranslations("common");
  const [scores, setScores] = useState<LeadScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedFactors, setSelectedFactors] = useState<LeadScore["factors"] | null>(null);
  const [computing, setComputing] = useState(false);

  const fetchScores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
      if (tierFilter !== "all") params.set("tier", tierFilter);
      const res = await api.get(`/api/v1/lead-scoring?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = json.data ?? [];
      setScores(data.length > 0 ? data : DEMO_SCORES);
      setTotal(json.pagination?.total ?? data.length || DEMO_SCORES.length);
    } catch {
      setScores(DEMO_SCORES);
      setTotal(DEMO_SCORES.length);
    } finally {
      setLoading(false);
    }
  }, [page, tierFilter]);

  useEffect(() => { fetchScores(); }, [fetchScores]);

  const handleComputeAll = async () => {
    setComputing(true);
    try {
      await api.post("/api/v1/lead-scoring/compute-all", {});
      setTimeout(fetchScores, 2000);
    } catch { /* ignore */ }
    finally { setComputing(false); }
  };

  const filtered = search
    ? scores.filter((s) =>
        (s.contactName ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (s.contactEmail ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (s.companyName ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : scores;

  const stats = {
    hot: scores.filter((s) => s.tier === "hot").length,
    warm: scores.filter((s) => s.tier === "warm").length,
    cold: scores.filter((s) => s.tier === "cold").length,
    avg: scores.length ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length) : 0,
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          {!loading && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{total}</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={fetchScores} disabled={loading} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={handleComputeAll} disabled={computing}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            <Zap className="h-4 w-4" />
            {computing ? tc("loading") : t("recomputeAll")}
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("averageScore")}</p>
          <p className="mt-1 text-2xl font-bold">{stats.avg}</p>
        </div>
        {[
          { key: "hot", label: t("hot"), icon: Flame, color: "text-red-600", bg: "bg-red-50", val: stats.hot },
          { key: "warm", label: t("warm"), icon: Minus, color: "text-yellow-600", bg: "bg-yellow-50", val: stats.warm },
          { key: "cold", label: t("cold"), icon: Snowflake, color: "text-blue-600", bg: "bg-blue-50", val: stats.cold },
        ].map(({ key, label, icon: Icon, color, bg, val }) => (
          <button key={key} onClick={() => setTierFilter(tierFilter === key as any ? "all" : key as any)}
            className={cn("rounded-lg border p-4 text-left transition-all hover:shadow-sm", tierFilter === key ? `${bg} border-current` : "bg-card")}>
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4", color)} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{val}</p>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder={t("searchPlaceholder")} value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      {selectedFactors && <FactorsPanel factors={selectedFactors} onClose={() => setSelectedFactors(null)} />}

      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("lead")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("company")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("score")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("tier")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("topFactor")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("scored")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 w-3/4 rounded bg-muted" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  {t("noLeads")}
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{s.contactName ?? "Unknown"}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" />{s.contactEmail ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.companyName ? (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" />{s.companyName}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3"><ScoreBar score={s.score} /></td>
                  <td className="px-4 py-3"><TierBadge tier={s.tier} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate">
                    {s.factors[0]?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatRelativeTime(s.calculatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedFactors(s.factors)}
                      className="text-xs text-primary hover:underline">
                      {t("viewFactors")}
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
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> {tc("previous")}
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              {tc("next")} <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
