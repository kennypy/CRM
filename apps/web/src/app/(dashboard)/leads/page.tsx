"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ColumnPicker, useColumnPrefs } from "@/components/ui/column-picker";
import type { ColDef } from "@/components/ui/column-picker";
import { TagInput } from "@/components/ui/tag-input";
import { OwnerPicker } from "@/components/ui/owner-picker";
import { AddToCampaignModal } from "@/components/marketing/add-to-campaign-modal";
import {
  TrendingUp, Search, RefreshCw, AlertCircle, Plus,
  ChevronLeft, ChevronRight, Flame, Minus, Snowflake,
  ArrowRight, Building2, Mail, X, User, CheckCircle2,
  Tag, UserCircle, Activity, Megaphone,
} from "lucide-react";

const LIFECYCLE_STAGES = ["subscriber", "lead", "mql", "sql", "opportunity", "customer"] as const;

const LIFECYCLE_COLORS: Record<string, string> = {
  subscriber:  "bg-gray-100 text-gray-700",
  lead:        "bg-blue-100 text-blue-700",
  mql:         "bg-purple-100 text-purple-700",
  sql:         "bg-indigo-100 text-indigo-700",
  opportunity: "bg-orange-100 text-orange-700",
  customer:    "bg-green-100 text-green-700",
};

const COL_DEFS: ColDef[] = [
  { key: "select",         label: "",              required: true },
  { key: "name",           label: "Lead",          required: true },
  { key: "company",        label: "Company" },
  { key: "score",          label: "Score" },
  { key: "tier",           label: "Tier" },
  { key: "lifecycleStage", label: "Stage" },
  { key: "owner",          label: "Owner" },
  { key: "source",         label: "Source" },
  { key: "tags",           label: "Tags" },
  { key: "lastActivity",   label: "Last Activity" },
  { key: "actions",        label: "Actions",       required: true },
];

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  company?: { id: string; name: string };
  score: number;
  tier: "hot" | "warm" | "cold";
  source: string;
  lifecycleStage: string;
  ownerId?: string;
  lastActivityAt?: string;
  createdAt: string;
}

// Deterministic score from ID — no Math.random() in render
function hashScore(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return 20 + (h % 61); // 20–80
}

function scoreTier(score: number): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function TierBadge({ tier, t }: { tier: string; t: (key: string) => string }) {
  const cfg: Record<string, { labelKey: string; icon: React.FC<{ className?: string }>; cls: string }> = {
    hot:  { labelKey: "hot",  icon: Flame,     cls: "bg-red-100 text-red-700" },
    warm: { labelKey: "warm", icon: Minus,     cls: "bg-yellow-100 text-yellow-700" },
    cold: { labelKey: "cold", icon: Snowflake, cls: "bg-blue-100 text-blue-700" },
  };
  const { labelKey, icon: Icon, cls } = cfg[tier] ?? cfg.cold;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>
      <Icon className="h-3 w-3" />
      {t(labelKey)}
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

// ── Add Lead Modal ─────────────────────────────────────────────────────────────

function AddLeadModal({ onClose, onCreated, t, tc }: { onClose: () => void; onCreated: () => void; t: (key: string) => string; tc: (key: string) => string }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", title: "", company: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post("/api/v1/contacts", {
        firstName: form.firstName,
        lastName:  form.lastName,
        email:     form.email,
        title:     form.title    || undefined,
        source:    "user",
        isLead:    true,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? "Failed to create lead");
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError(tc("networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{t("addLeadModal")}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("firstNameRequired")}</label>
              <input value={form.firstName} onChange={set("firstName")} required placeholder="Ada"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("lastNameRequired")}</label>
              <input value={form.lastName} onChange={set("lastName")} required placeholder="Lovelace"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("emailRequired")}</label>
            <input type="email" value={form.email} onChange={set("email")} required placeholder="ada@company.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{tc("title")}</label>
            <input value={form.title} onChange={set("title")} placeholder="VP Engineering"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              {tc("cancel")}
            </button>
            <button type="submit" disabled={loading}
              className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                loading ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
              {loading ? t("creating") : t("createLead")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Convert Lead Modal ─────────────────────────────────────────────────────────

function ConvertLeadModal({ lead, onClose, onConverted, t, tc }: {
  lead: Lead; onClose: () => void; onConverted: () => void; t: (key: string) => string; tc: (key: string) => string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleConvert = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.patch(`/api/v1/contacts/${lead.id}`, { isLead: false, source: "converted" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? "Failed to convert lead");
        return;
      }
      setDone(true);
      setTimeout(() => { onConverted(); onClose(); }, 1200);
    } catch {
      setError(tc("networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border bg-card shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">{t("convertLead")}</h2>
            <p className="text-sm text-muted-foreground">{lead.firstName} {lead.lastName}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          {t("convertDescription")}
        </p>
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}
        {done && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" /> {t("convertedToContact")}
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
            {tc("cancel")}
          </button>
          <button onClick={handleConvert} disabled={loading || done}
            className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
              (loading || done) ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
            {loading ? t("creating") : t("convertToContact")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function LeadsPage() {
  const t  = useTranslations("leads");
  const tc = useTranslations("common");
  const tl = useTranslations("lifecycle");
  const tb = useTranslations("bulk");
  const { visible, toggle } = useColumnPrefs("nexcrm_cols_leads", COL_DEFS);
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [search, setSearch]         = useState("");
  const [debounced, setDebounced]   = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [showAddCampaign, setShowAddCampaign] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((l) => l.id)));
  };
  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} leads?`)) return;
    await Promise.all([...selected].map((id) => api.delete(`/api/v1/contacts/${id}`)));
    setSelected(new Set());
    fetchLeads();
  };

  const tierLabels: Record<string, string> = {
    hot: "Hot",
    warm: "Warm",
    cold: "Cold",
  };

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
      const res = await api.get(`/api/v1/contacts?${params}&isLead=true`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const raw: Lead[] = (json.data ?? []).map((c: any) => {
        const score = c.engagementScore ?? hashScore(c.id);
        return {
          id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email,
          title: c.title, company: c.company,
          score,
          tier: scoreTier(score),
          source: c.source ?? "auto",
          lifecycleStage: c.lifecycleStage ?? "lead",
          ownerId: c.ownerId,
          lastActivityAt: c.lastActivityAt,
          createdAt: c.createdAt,
        };
      });
      setLeads(raw);
      setTotal(json.pagination?.total ?? raw.length);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, debounced]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const filtered = leads
    .filter((l) => tierFilter === "all" || l.tier === tierFilter)
    .filter((l) => stageFilter === "all" || l.lifecycleStage === stageFilter);
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
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          {!loading && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{total.toLocaleString()}</span>}
        </div>
        <div className="flex gap-2">
          <ColumnPicker defs={COL_DEFS} visible={visible} toggle={toggle} />
          <button onClick={fetchLeads} disabled={loading} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> {t("addLead")}
          </button>
        </div>
      </div>

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} onCreated={fetchLeads} t={t} tc={tc} />}
      {converting && (
        <ConvertLeadModal
          lead={converting}
          onClose={() => setConverting(null)}
          onConverted={fetchLeads}
          t={t}
          tc={tc}
        />
      )}

      {/* Tier summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: "hot",  label: tierLabels.hot,  icon: Flame,     color: "text-red-600",    bg: "bg-red-50",    val: stats.hot },
          { key: "warm", label: tierLabels.warm, icon: Minus,     color: "text-yellow-600", bg: "bg-yellow-50", val: stats.warm },
          { key: "cold", label: tierLabels.cold, icon: Snowflake, color: "text-blue-600",   bg: "bg-blue-50",   val: stats.cold },
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

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          {["all", ...LIFECYCLE_STAGES].map((s) => (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                stageFilter === s ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              {s === "all" ? tc("all") : tl(s)}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-primary/5 px-4 py-2">
          <span className="text-sm font-medium">{tb("selected", { count: selected.size })}</span>
          <button onClick={() => setShowAddCampaign(true)} className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20">
            <Megaphone className="h-3.5 w-3.5" /> Add to campaign
          </button>
          <button onClick={handleBulkDelete} className="rounded-md bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200">
            {tb("deleteSelected")}
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            {tb("clearSelection")}
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              {COL_DEFS.filter((d) => visible.has(d.key)).map((col) => (
                <th key={col.key} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {col.key === "select" ? (
                    <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length}
                      onChange={toggleSelectAll} className="rounded border-border" />
                  ) : col.key === "actions" ? "" : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {COL_DEFS.filter((d) => visible.has(d.key)).map((col) => (
                    <td key={col.key} className="px-4 py-3"><div className="h-4 w-3/4 rounded bg-muted" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={COL_DEFS.filter((d) => visible.has(d.key)).length} className="px-4 py-12 text-center text-muted-foreground">
                  {debounced ? t("noMatch") : t("empty")}
                </td>
              </tr>
            ) : (
              filtered.map((lead) => (
                <tr key={lead.id} className={cn("hover:bg-muted/40 transition-colors", selected.has(lead.id) && "bg-primary/5")}>
                  {visible.has("select") && (
                    <td className="px-4 py-3 w-10">
                      <input type="checkbox" checked={selected.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)} className="rounded border-border" />
                    </td>
                  )}
                  {visible.has("name") && (
                    <td className="px-4 py-3">
                      <p className="font-medium">{lead.firstName} {lead.lastName}</p>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />{lead.email}
                      </div>
                    </td>
                  )}
                  {visible.has("company") && (
                    <td className="px-4 py-3">
                      {lead.company ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Building2 className="h-3.5 w-3.5" />{lead.company.name}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  {visible.has("score") && (
                    <td className="px-4 py-3"><ScoreBar score={lead.score} /></td>
                  )}
                  {visible.has("tier") && (
                    <td className="px-4 py-3"><TierBadge tier={lead.tier} t={t} /></td>
                  )}
                  {visible.has("lifecycleStage") && (
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", LIFECYCLE_COLORS[lead.lifecycleStage] ?? "bg-gray-100")}>
                        {tl(lead.lifecycleStage as any, { defaultValue: lead.lifecycleStage })}
                      </span>
                    </td>
                  )}
                  {visible.has("owner") && (
                    <td className="px-4 py-3">
                      <OwnerPicker
                        value={lead.ownerId}
                        onChange={async (userId) => {
                          await api.patch(`/api/v1/contacts/${lead.id}`, { ownerId: userId });
                          fetchLeads();
                        }}
                        compact
                      />
                    </td>
                  )}
                  {visible.has("source") && (
                    <td className="px-4 py-3 capitalize text-muted-foreground">{lead.source}</td>
                  )}
                  {visible.has("tags") && (
                    <td className="px-4 py-3">
                      <TagInput entityType="lead" entityId={lead.id} />
                    </td>
                  )}
                  {visible.has("lastActivity") && (
                    <td className="px-4 py-3 text-muted-foreground">
                      {lead.lastActivityAt ? formatRelativeTime(lead.lastActivityAt) : tc("never")}
                    </td>
                  )}
                  {visible.has("actions") && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setConverting(lead)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {t("convert")} <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">{tc("pageOf", { page: String(page), totalPages: String(totalPages), total: String(total) })}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading} className="flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> {tc("previous")}
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading} className="flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              {tc("next")} <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {showAddCampaign && (
        <AddToCampaignModal
          contactIds={[...selected]}
          onClose={() => setShowAddCampaign(false)}
          onDone={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}
