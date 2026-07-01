"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useTenant } from "@/lib/tenant-context";
import { usePermissions } from "@/lib/permissions";
import { ColumnPicker, useColumnPrefs } from "@/components/ui/column-picker";
import type { ColDef } from "@/components/ui/column-picker";
import {
  Megaphone, Search, RefreshCw, AlertCircle, Plus,
  ChevronLeft, ChevronRight, X, MoreHorizontal,
  Play, Pause, Archive, Trash2, BarChart3,
  Mail, Globe, Calendar, Target, Users, DollarSign,
  Eye, MousePointerClick, UserPlus, TrendingUp,
} from "lucide-react";

const PAGE_SIZE = 50;

const CAMPAIGN_TYPES = [
  "email", "social", "event", "webinar", "content",
  "paid_search", "paid_social", "abm", "referral", "other",
] as const;

const CAMPAIGN_STATUSES = [
  "draft", "scheduled", "active", "paused", "completed", "archived",
] as const;

const CHANNELS = [
  "email", "linkedin", "facebook", "google", "twitter",
  "instagram", "webinar", "event", "sms", "direct_mail", "other",
] as const;

interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: string;
  status: string;
  channel?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  actualSpend?: number;
  currency: string;
  targetAudience?: string;
  goals?: string;
  ownerId?: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  unsubscribed: number;
  bounced: number;
  leadsGenerated: number;
  mqls: number;
  sqls: number;
  opportunities: number;
  closedWon: number;
  revenue: number;
  tags: string[];
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

const COL_DEFS: ColDef[] = [
  { key: "name",        label: "Campaign",     required: true },
  { key: "type",        label: "Type" },
  { key: "status",      label: "Status" },
  { key: "channel",     label: "Channel" },
  { key: "dates",       label: "Dates" },
  { key: "budget",      label: "Budget" },
  { key: "contacts",    label: "Contacts" },
  { key: "sent",        label: "Sent" },
  { key: "opened",      label: "Opened" },
  { key: "clicked",     label: "Clicked" },
  { key: "converted",   label: "Converted" },
  { key: "revenue",     label: "Revenue" },
  { key: "actions",     label: "Actions",      required: true },
];

const STATUS_COLORS: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-100 text-blue-700",
  active:    "bg-green-100 text-green-700",
  paused:    "bg-yellow-100 text-yellow-700",
  completed: "bg-purple-100 text-purple-700",
  archived:  "bg-gray-200 text-gray-500",
};

const TYPE_ICONS: Record<string, typeof Mail> = {
  email: Mail, social: Globe, event: Calendar, webinar: Target,
  content: BarChart3, paid_search: Search, paid_social: Globe,
  abm: Target, referral: Users, other: Megaphone,
};

export default function MarketingPage() {
  const t = useTranslations("marketing");
  const tc = useTranslations("common");
  const { tenant } = useTenant();
  const { canWrite } = usePermissions();
  const { visible, toggle } = useColumnPrefs("nexcrm_cols_campaigns", COL_DEFS);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchCampaigns = useCallback(async (p = page, q = search, status = statusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (q) params.set("search", q);
      if (status !== "all") params.set("status", status);
      const res = await api.get(`/api/v1/campaigns?${params}`);
      if (!res.ok) throw new Error("Failed to load campaigns");
      const json = await res.json();
      setCampaigns(json.data);
      setTotal(json.pagination?.total ?? json.data.length);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, t]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); fetchCampaigns(1, v, statusFilter); }, 300);
  };

  const handleStatusFilter = (s: string) => {
    setStatusFilter(s);
    setPage(1);
    fetchCampaigns(1, search, s);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    await api.delete(`/api/v1/campaigns/${id}`);
    fetchCampaigns();
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    await api.patch(`/api/v1/campaigns/${id}`, { status: newStatus });
    fetchCampaigns();
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const fmt = (n: number) => new Intl.NumberFormat(tenant?.locale ?? "en-US").format(n);
  const fmtCurrency = (n: number, currency = "USD") =>
    new Intl.NumberFormat(tenant?.locale ?? "en-US", { style: "currency", currency }).format(n);

  // Create campaign form
  const [form, setForm] = useState({
    name: "", description: "", type: "email" as string, status: "draft" as string,
    channel: "" as string, startDate: "", endDate: "", budget: "",
    currency: tenant?.defaultCurrency ?? "USD",
    targetAudience: "", goals: "",
  });
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name, type: form.type, status: form.status, currency: form.currency,
      };
      if (form.description) body.description = form.description;
      if (form.channel) body.channel = form.channel;
      if (form.startDate) body.startDate = form.startDate;
      if (form.endDate) body.endDate = form.endDate;
      if (form.budget) body.budget = Number(form.budget);
      if (form.targetAudience) body.targetAudience = form.targetAudience;
      if (form.goals) body.goals = form.goals;
      const res = await api.post("/api/v1/campaigns", body);
      if (!res.ok) throw new Error("Create failed");
      setShowCreate(false);
      setForm({ name: "", description: "", type: "email", status: "draft", channel: "", startDate: "", endDate: "", budget: "", currency: tenant?.defaultCurrency ?? "USD", targetAudience: "", goals: "" });
      fetchCampaigns();
    } catch {
      setError(t("createError"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Megaphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchCampaigns()} className="rounded-lg border p-2 hover:bg-muted">
            <RefreshCw className="h-4 w-4" />
          </button>
          <ColumnPicker defs={COL_DEFS} visible={visible} toggle={toggle} />
          {canWrite && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> {t("newCampaign")}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          {search && (
            <button onClick={() => handleSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          {["all", ...CAMPAIGN_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => handleStatusFilter(s)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                statusFilter === s ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              {s === "all" ? tc("all") : t(`status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {COL_DEFS.filter((c) => visible.has(c.key)).map((col) => (
                <th key={col.key} className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {t(`col.${col.key}`, { defaultValue: col.label })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {COL_DEFS.filter((c) => visible.has(c.key)).map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan={COL_DEFS.filter((c) => visible.has(c.key)).length} className="px-4 py-12 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            ) : (
              campaigns.map((c) => {
                const TypeIcon = TYPE_ICONS[c.type] ?? Megaphone;
                const openRate = c.sent > 0 ? ((c.opened / c.sent) * 100).toFixed(1) : "0";
                const clickRate = c.sent > 0 ? ((c.clicked / c.sent) * 100).toFixed(1) : "0";
                return (
                  <tr key={c.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedCampaign(c)}>
                    {visible.has("name") && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <TypeIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{c.name}</span>
                        </div>
                      </td>
                    )}
                    {visible.has("type") && (
                      <td className="px-4 py-3 capitalize">{c.type.replace(/_/g, " ")}</td>
                    )}
                    {visible.has("status") && (
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", STATUS_COLORS[c.status] ?? "bg-gray-100")}>
                          {t(`status.${c.status}`, { defaultValue: c.status })}
                        </span>
                      </td>
                    )}
                    {visible.has("channel") && (
                      <td className="px-4 py-3 capitalize">{c.channel?.replace(/_/g, " ") ?? "—"}</td>
                    )}
                    {visible.has("dates") && (
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.startDate ? new Date(c.startDate).toLocaleDateString() : "—"}
                        {c.endDate ? ` → ${new Date(c.endDate).toLocaleDateString()}` : ""}
                      </td>
                    )}
                    {visible.has("budget") && (
                      <td className="px-4 py-3">
                        {c.budget != null ? fmtCurrency(c.budget, c.currency) : "—"}
                      </td>
                    )}
                    {visible.has("contacts") && (
                      <td className="px-4 py-3">{fmt(c.contactCount)}</td>
                    )}
                    {visible.has("sent") && <td className="px-4 py-3">{fmt(c.sent)}</td>}
                    {visible.has("opened") && (
                      <td className="px-4 py-3">
                        <span>{fmt(c.opened)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({openRate}%)</span>
                      </td>
                    )}
                    {visible.has("clicked") && (
                      <td className="px-4 py-3">
                        <span>{fmt(c.clicked)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">({clickRate}%)</span>
                      </td>
                    )}
                    {visible.has("converted") && <td className="px-4 py-3">{fmt(c.converted)}</td>}
                    {visible.has("revenue") && (
                      <td className="px-4 py-3 font-medium">{fmtCurrency(c.revenue, c.currency)}</td>
                    )}
                    {visible.has("actions") && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {c.status === "draft" && canWrite && (
                            <button onClick={() => handleStatusChange(c.id, "active")} className="rounded p-1 hover:bg-muted" title={t("activate")}>
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {c.status === "active" && canWrite && (
                            <button onClick={() => handleStatusChange(c.id, "paused")} className="rounded p-1 hover:bg-muted" title={t("pause")}>
                              <Pause className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {c.status === "paused" && canWrite && (
                            <button onClick={() => handleStatusChange(c.id, "active")} className="rounded p-1 hover:bg-muted" title={t("resume")}>
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canWrite && (
                            <button onClick={() => handleDelete(c.id)} className="rounded p-1 hover:bg-red-50 text-red-500" title={tc("delete")}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{tc("pageOf", { page, totalPages, total })}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => { setPage(page - 1); fetchCampaigns(page - 1); }}
              className="rounded-lg border px-3 py-1 disabled:opacity-40 hover:bg-muted">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button disabled={page >= totalPages} onClick={() => { setPage(page + 1); fetchCampaigns(page + 1); }}
              className="rounded-lg border px-3 py-1 disabled:opacity-40 hover:bg-muted">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create Campaign Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("newCampaign")}</h2>
              <button onClick={() => setShowCreate(false)} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("campaignName")}</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("description")}</label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("type")}</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                    {CAMPAIGN_TYPES.map((t) => (
                      <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("channel")}</label>
                  <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="">—</option>
                    {CHANNELS.map((ch) => (
                      <option key={ch} value={ch}>{ch.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("startDate")}</label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("endDate")}</label>
                  <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("budget")}</label>
                  <input type="number" min={0} step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("targetAudience")}</label>
                  <input value={form.targetAudience} onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("goals")}</label>
                <input value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <button type="submit" disabled={creating}
                className={cn("w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity", creating ? "opacity-60" : "hover:opacity-90")}>
                {creating ? t("creating") : t("createCampaign")}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Campaign Detail Panel */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedCampaign(null)}>
          <div className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-2xl border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">{selectedCampaign.name}</h2>
                <p className="text-sm text-muted-foreground">{selectedCampaign.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("rounded-full px-3 py-1 text-xs font-medium capitalize", STATUS_COLORS[selectedCampaign.status])}>
                  {t(`status.${selectedCampaign.status}`, { defaultValue: selectedCampaign.status })}
                </span>
                <button onClick={() => setSelectedCampaign(null)} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="mb-6 grid grid-cols-4 gap-3">
              {[
                { label: t("metricSent"), value: fmt(selectedCampaign.sent), icon: Mail },
                { label: t("metricOpened"), value: `${fmt(selectedCampaign.opened)} (${selectedCampaign.sent ? ((selectedCampaign.opened / selectedCampaign.sent) * 100).toFixed(1) : 0}%)`, icon: Eye },
                { label: t("metricClicked"), value: `${fmt(selectedCampaign.clicked)} (${selectedCampaign.sent ? ((selectedCampaign.clicked / selectedCampaign.sent) * 100).toFixed(1) : 0}%)`, icon: MousePointerClick },
                { label: t("metricConverted"), value: fmt(selectedCampaign.converted), icon: UserPlus },
                { label: t("metricLeads"), value: fmt(selectedCampaign.leadsGenerated), icon: TrendingUp },
                { label: t("metricMQLs"), value: fmt(selectedCampaign.mqls), icon: Target },
                { label: t("metricSQLs"), value: fmt(selectedCampaign.sqls), icon: Users },
                { label: t("metricRevenue"), value: fmtCurrency(selectedCampaign.revenue, selectedCampaign.currency), icon: DollarSign },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{value}</div>
                </div>
              ))}
            </div>

            {/* Campaign Details */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t("type")}:</span>{" "}
                <span className="capitalize">{selectedCampaign.type.replace(/_/g, " ")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("channel")}:</span>{" "}
                <span className="capitalize">{selectedCampaign.channel?.replace(/_/g, " ") ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("budget")}:</span>{" "}
                {selectedCampaign.budget != null ? fmtCurrency(selectedCampaign.budget, selectedCampaign.currency) : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">{t("actualSpend")}:</span>{" "}
                {selectedCampaign.actualSpend != null ? fmtCurrency(selectedCampaign.actualSpend, selectedCampaign.currency) : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">{t("startDate")}:</span>{" "}
                {selectedCampaign.startDate ? new Date(selectedCampaign.startDate).toLocaleDateString() : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">{t("endDate")}:</span>{" "}
                {selectedCampaign.endDate ? new Date(selectedCampaign.endDate).toLocaleDateString() : "—"}
              </div>
              {selectedCampaign.targetAudience && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t("targetAudience")}:</span>{" "}
                  {selectedCampaign.targetAudience}
                </div>
              )}
              {selectedCampaign.goals && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t("goals")}:</span>{" "}
                  {selectedCampaign.goals}
                </div>
              )}
              <div>
                <span className="text-muted-foreground">{t("contacts")}:</span>{" "}
                {fmt(selectedCampaign.contactCount)}
              </div>
              <div>
                <span className="text-muted-foreground">{t("unsubscribed")}:</span>{" "}
                {fmt(selectedCampaign.unsubscribed)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
