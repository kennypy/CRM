"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  Store, RefreshCw, AlertCircle, Search, CheckCircle2,
  ExternalLink, X, Video, MessageSquare, Database,
  ArrowUpDown, Mail, BarChart3, Shield, Zap,
} from "lucide-react";

interface MarketplaceApp {
  id: string;
  slug: string;
  name: string;
  description: string;
  shortDescription: string | null;
  iconUrl: string | null;
  publisher: string;
  category: string;
  authType: string;
  configSchema: Record<string, unknown>;
  scopes: string[];
  version: string;
  isInstalled: boolean;
  installId: string | null;
  installStatus: string | null;
}

interface Install {
  id: string;
  appId: string;
  appName: string | null;
  appSlug: string | null;
  appIcon: string | null;
  appCategory: string | null;
  status: string;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const CATEGORY_ICONS: Record<string, React.FC<{ className?: string }>> = {
  communication: MessageSquare,
  productivity: ArrowUpDown,
  analytics: BarChart3,
  data_enrichment: Database,
  marketing: Mail,
  support: Shield,
  finance: Zap,
  custom: Store,
};

const CATEGORY_COLORS: Record<string, string> = {
  communication: "bg-blue-100 text-blue-700",
  productivity: "bg-purple-100 text-purple-700",
  analytics: "bg-indigo-100 text-indigo-700",
  data_enrichment: "bg-green-100 text-green-700",
  marketing: "bg-pink-100 text-pink-700",
  support: "bg-orange-100 text-orange-700",
  finance: "bg-yellow-100 text-yellow-700",
  custom: "bg-gray-100 text-gray-700",
};

const APP_ICONS: Record<string, React.FC<{ className?: string }>> = {
  zoom: Video,
  slack: MessageSquare,
  clearbit: Database,
  "hubspot-import": ArrowUpDown,
  mailchimp: Mail,
};

// Demo apps for when API returns empty
const DEMO_APPS: MarketplaceApp[] = [
  { id: "1", slug: "zoom", name: "Zoom", description: "Automatically ingest and transcribe Zoom meeting recordings. Extract action items, sentiment, and buying signals from sales calls.", shortDescription: "Meeting transcription & analysis", iconUrl: null, publisher: "NexCRM", category: "communication", authType: "oauth2", configSchema: {}, scopes: [], version: "1.0.0", isInstalled: false, installId: null, installStatus: null },
  { id: "2", slug: "slack", name: "Slack", description: "Monitor Slack channels for deal mentions, customer requests, and team collaboration signals. Auto-capture activities from conversations.", shortDescription: "Channel monitoring & signal capture", iconUrl: null, publisher: "NexCRM", category: "communication", authType: "oauth2", configSchema: {}, scopes: [], version: "1.0.0", isInstalled: false, installId: null, installStatus: null },
  { id: "3", slug: "clearbit", name: "Clearbit Enrichment", description: "Enrich contacts and companies with firmographic, technographic, and demographic data. Auto-fill missing fields on new records.", shortDescription: "Contact & company data enrichment", iconUrl: null, publisher: "Clearbit", category: "data_enrichment", authType: "api_key", configSchema: {}, scopes: [], version: "1.0.0", isInstalled: false, installId: null, installStatus: null },
  { id: "4", slug: "hubspot-import", name: "HubSpot Import", description: "One-click migration from HubSpot CRM. Import contacts, companies, deals, and activities with field mapping and deduplication.", shortDescription: "Migrate from HubSpot CRM", iconUrl: null, publisher: "NexCRM", category: "productivity", authType: "api_key", configSchema: {}, scopes: [], version: "1.0.0", isInstalled: false, installId: null, installStatus: null },
  { id: "5", slug: "mailchimp", name: "Mailchimp", description: "Sync contacts and segments with Mailchimp for email marketing campaigns. Track email engagement as CRM activities.", shortDescription: "Email marketing sync & tracking", iconUrl: null, publisher: "Mailchimp", category: "marketing", authType: "api_key", configSchema: {}, scopes: [], version: "1.0.0", isInstalled: false, installId: null, installStatus: null },
];

function AppDetailModal({ app, onClose, onInstall, onUninstall, installing }: {
  app: MarketplaceApp; onClose: () => void;
  onInstall: (appId: string) => void; onUninstall: (installId: string) => void;
  installing: boolean;
}) {
  const t = useTranslations("marketplace");
  const tc = useTranslations("common");
  const Icon = APP_ICONS[app.slug] ?? Store;
  const catColor = CATEGORY_COLORS[app.category] ?? CATEGORY_COLORS.custom;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold">{app.name}</h2>
              <p className="text-xs text-muted-foreground">by {app.publisher} · v{app.version}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", catColor)}>
              {app.category.replace("_", " ")}
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground capitalize">
              {app.authType.replace("_", " ")}
            </span>
          </div>
          <p className="text-sm leading-relaxed">{app.description}</p>
          {app.isInstalled && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> {t("installedActive")}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            {app.isInstalled ? (
              <button onClick={() => app.installId && onUninstall(app.installId)}
                className="flex-1 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                {t("uninstall")}
              </button>
            ) : (
              <button onClick={() => onInstall(app.id)} disabled={installing}
                className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                  installing ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
                {installing ? t("installing") : t("install")}
              </button>
            )}
            <button onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              {tc("close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const t = useTranslations("marketplace");
  const tc = useTranslations("common");
  const [apps, setApps] = useState<MarketplaceApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedApp, setSelectedApp] = useState<MarketplaceApp | null>(null);
  const [installing, setInstalling] = useState(false);
  const [tab, setTab] = useState<"browse" | "installed">("browse");

  const fetchApps = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = tab === "installed" ? "/api/v1/marketplace/installs" : "/api/v1/marketplace";
      const params = categoryFilter !== "all" ? `?category=${categoryFilter}` : "";
      const res = await api.get(`${endpoint}${params}`);
      if (res.ok) {
        const json = await res.json();
        setApps(json.data ?? []);
      } else {
        setApps([]);
      }
    } catch {
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, [tab, categoryFilter]);

  useEffect(() => { fetchApps(); }, [fetchApps]);

  const handleInstall = async (appId: string) => {
    setInstalling(true);
    try {
      const res = await api.post("/api/v1/marketplace/install", { appId });
      if (res.ok) {
        setApps((prev) => prev.map((a) => a.id === appId ? { ...a, isInstalled: true } : a));
        setSelectedApp(null);
      }
    } catch { /* ignore */ }
    finally { setInstalling(false); }
  };

  const handleUninstall = async (installId: string) => {
    try {
      await api.delete(`/api/v1/marketplace/installs/${installId}`);
      fetchApps();
      setSelectedApp(null);
    } catch { /* ignore */ }
  };

  const filtered = search
    ? apps.filter((a) => {
        const name = (a as any).appName ?? a.name ?? "";
        const desc = (a as any).shortDescription ?? a.description ?? "";
        const q = search.toLowerCase();
        return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
      })
    : apps;

  const categories = ["all", "communication", "data_enrichment", "productivity", "marketing", "analytics"];

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
        </div>
        <button onClick={fetchApps} disabled={loading} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(["browse", "installed"] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={cn("rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors",
              tab === tb ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {tb === "browse" ? t("browseApps") : t("installed")}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder={t("searchPlaceholder")} value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {tab === "browse" && (
          <div className="flex gap-1">
            {categories.map((cat) => (
              <button key={cat} onClick={() => setCategoryFilter(cat)}
                className={cn("rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  categoryFilter === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
                {cat === "all" ? t("allCategories") : cat.replace("_", " ")}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedApp && (
        <AppDetailModal app={selectedApp} onClose={() => setSelectedApp(null)}
          onInstall={handleInstall} onUninstall={handleUninstall} installing={installing} />
      )}

      {/* App grid */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-muted" />
                  <div className="flex-1"><div className="h-4 w-1/2 rounded bg-muted mb-1" /><div className="h-3 w-1/3 rounded bg-muted" /></div>
                </div>
                <div className="h-3 w-full rounded bg-muted mb-2" />
                <div className="h-3 w-2/3 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Store className="h-12 w-12 mb-3 text-muted-foreground/40" />
            <p className="font-medium">{tab === "installed" ? t("noInstalled") : t("noApps")}</p>
            <p className="text-sm">{tab === "installed" ? t("browsePrompt") : t("tryDifferent")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((app) => {
              const name = (app as any).appName ?? app.name;
              const slug = (app as any).appSlug ?? app.slug;
              const category = (app as any).appCategory ?? app.category;
              const Icon = APP_ICONS[slug] ?? Store;
              const catColor = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.custom;

              return (
                <div key={app.id}
                  onClick={() => setSelectedApp(app)}
                  className="cursor-pointer rounded-xl border bg-card p-5 transition-all hover:shadow-md hover:border-primary/30">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold truncate">{name}</p>
                        {app.isInstalled && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{(app as any).publisher ?? ""}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {app.shortDescription ?? app.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize", catColor)}>
                      {(category ?? "custom").replace("_", " ")}
                    </span>
                    {!app.isInstalled && (
                      <span className="text-xs text-primary font-medium">Install &rarr;</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
