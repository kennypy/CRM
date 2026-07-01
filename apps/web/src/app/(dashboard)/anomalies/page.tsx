"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  ShieldAlert, RefreshCw, AlertCircle, AlertTriangle,
  CheckCircle2, Eye, X, Zap, Clock, TrendingDown,
  Users, MessageSquare, DollarSign, Ghost,
} from "lucide-react";

interface AnomalyAlert {
  id: string;
  entityType: string;
  entityId: string;
  alertType: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  evidence: Array<{ label: string; detail: string }>;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ALERT_TYPE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  stalled_deal: Clock,
  at_risk_account: TrendingDown,
  engagement_drop: TrendingDown,
  champion_left: Users,
  competitor_mention: MessageSquare,
  budget_cut_signal: DollarSign,
  unusual_activity: AlertTriangle,
  ghost_deal: Ghost,
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; badge: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-700", badge: "bg-red-100 text-red-800" },
  high:     { bg: "bg-orange-50", text: "text-orange-700", badge: "bg-orange-100 text-orange-800" },
  medium:   { bg: "bg-yellow-50", text: "text-yellow-700", badge: "bg-yellow-100 text-yellow-800" },
  low:      { bg: "bg-blue-50", text: "text-blue-700", badge: "bg-blue-100 text-blue-800" },
};

// Demo data
const DEMO_ALERTS: AnomalyAlert[] = [
  { id: "1", entityType: "deal", entityId: "d1", alertType: "stalled_deal", severity: "critical",
    title: "Acme Corp deal stalled — 14 days no activity",
    description: "Enterprise License deal in Negotiation stage has had no emails, calls, or meetings for 14 days. Historical deals at this stage average 3 activities per week.",
    evidence: [{ label: "Last activity", detail: "Email to sarah@acme.com on Feb 21" }, { label: "Average cadence", detail: "3.2 activities/week at Negotiation stage" }],
    status: "open", acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "2", entityType: "deal", entityId: "d2", alertType: "champion_left", severity: "high",
    title: "Champion left TechStart — James Wilson no longer at company",
    description: "Primary contact James Wilson (CTO) appears to have left TechStart based on LinkedIn activity and bounced email. Deal is in Proposal stage with $85K value.",
    evidence: [{ label: "Signal", detail: "LinkedIn title changed to 'Open to Work'" }, { label: "Email bounce", detail: "james@techstart.io returned 550 error on Mar 5" }],
    status: "open", acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, createdAt: new Date(Date.now() - 7200000).toISOString(), updatedAt: new Date(Date.now() - 7200000).toISOString() },
  { id: "3", entityType: "company", entityId: "c1", alertType: "engagement_drop", severity: "medium",
    title: "Globex engagement dropped 60% week-over-week",
    description: "Activity volume from Globex contacts dropped from 12 interactions last week to 5 this week. Two open deals worth $95K combined.",
    evidence: [{ label: "Last week", detail: "12 activities (4 emails, 5 calls, 3 meetings)" }, { label: "This week", detail: "5 activities (3 emails, 2 calls)" }],
    status: "open", acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: "4", entityType: "deal", entityId: "d3", alertType: "competitor_mention", severity: "medium",
    title: "Competitor mentioned in NovaCorp call",
    description: "During last sales call with NovaCorp, prospect mentioned evaluating 'HubSpot' as an alternative. Deal is in Qualified stage.",
    evidence: [{ label: "Source", detail: "Call transcript Mar 4, 2026" }, { label: "Quote", detail: "'We're also looking at HubSpot for the sales team'" }],
    status: "open", acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, createdAt: new Date(Date.now() - 172800000).toISOString(), updatedAt: new Date(Date.now() - 172800000).toISOString() },
  { id: "5", entityType: "deal", entityId: "d4", alertType: "ghost_deal", severity: "low",
    title: "Phantom Pipeline — OldCo deal has zero engagement",
    description: "Deal 'OldCo - Starter' has been in Discovery stage for 30 days with no recorded activities. Consider removing from active pipeline.",
    evidence: [{ label: "Deal age", detail: "30 days" }, { label: "Activities", detail: "0 total" }],
    status: "open", acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, createdAt: new Date(Date.now() - 259200000).toISOString(), updatedAt: new Date(Date.now() - 259200000).toISOString() },
];

export default function AnomaliesPage() {
  const t = useTranslations("anomalies");
  const tc = useTranslations("common");
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"open" | "acknowledged" | "resolved" | "dismissed">("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [summary, setSummary] = useState<Record<string, number>>({});

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        api.get(`/api/v1/anomalies?status=${statusFilter}`),
        api.get("/api/v1/anomalies/summary"),
      ]);
      if (aRes.ok) {
        const json = await aRes.json();
        setAlerts(json.data ?? []);
      } else {
        setAlerts([]);
      }
      if (sRes.ok) {
        const sJson = await sRes.json();
        setSummary(sJson.data ?? { open_count: 0, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0 });
      } else {
        setSummary({ open_count: 0, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0 });
      }
    } catch {
      setAlerts([]);
      setSummary({ open_count: 0, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0 });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const handleAction = async (id: string, status: "acknowledged" | "resolved" | "dismissed") => {
    try {
      await api.patch(`/api/v1/anomalies/${id}`, { status });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch { /* fallback: remove from UI */ setAlerts((prev) => prev.filter((a) => a.id !== id)); }
  };

  const handleScan = async () => {
    setScanning(true);
    try { await api.post("/api/v1/anomalies/scan", {}); setTimeout(fetchAlerts, 3000); } catch (err) { console.error("Anomaly scan failed:", err); }
    finally { setScanning(false); }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          {summary.open_count > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{t("openCount", { count: summary.open_count })}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAlerts} disabled={loading} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={handleScan} disabled={scanning}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            <Zap className="h-4 w-4" />{scanning ? t("scanning") : t("runScan")}
          </button>
        </div>
      </div>

      {/* Severity summary */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: t("critical"), key: "critical_count", cls: "border-red-200 bg-red-50 text-red-700" },
          { label: t("high"),     key: "high_count",     cls: "border-orange-200 bg-orange-50 text-orange-700" },
          { label: t("medium"),   key: "medium_count",   cls: "border-yellow-200 bg-yellow-50 text-yellow-700" },
          { label: t("low"),      key: "low_count",      cls: "border-blue-200 bg-blue-50 text-blue-700" },
        ].map(({ label, key, cls }) => (
          <div key={key} className={cn("rounded-lg border p-4", cls)}>
            <p className="text-xs font-medium">{label}</p>
            <p className="mt-1 text-2xl font-bold">{summary[key] ?? 0}</p>
          </div>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(["open", "acknowledged", "resolved", "dismissed"] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn("rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors",
              statusFilter === s ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {s}
          </button>
        ))}
      </div>

      {/* Alert list */}
      <div className="flex-1 space-y-3 overflow-auto">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg border p-4">
              <div className="h-4 w-1/2 rounded bg-muted mb-2" />
              <div className="h-3 w-3/4 rounded bg-muted" />
            </div>
          ))
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mb-3 text-green-400" />
            <p className="font-medium">{t("allClear")}</p>
            <p className="text-sm">{t("noAnomalies", { status: statusFilter })}</p>
          </div>
        ) : (
          alerts.map((alert) => {
            const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.low;
            const AlertIcon = ALERT_TYPE_ICONS[alert.alertType] ?? AlertTriangle;
            const isExpanded = expandedId === alert.id;

            return (
              <div key={alert.id} className={cn("rounded-lg border transition-all", style.bg)}>
                <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : alert.id)}>
                  <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", style.badge)}>
                    <AlertIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium uppercase", style.badge)}>{alert.severity}</span>
                      <span className="text-xs text-muted-foreground capitalize">{alert.alertType.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground">· {formatRelativeTime(alert.createdAt)}</span>
                    </div>
                    <p className={cn("font-medium", style.text)}>{alert.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{alert.description}</p>
                  </div>
                  {statusFilter === "open" && (
                    <div className="flex shrink-0 gap-1">
                      <button onClick={(e) => { e.stopPropagation(); handleAction(alert.id, "acknowledged"); }}
                        title={t("acknowledge")} className="rounded-md p-1.5 hover:bg-white/60">
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleAction(alert.id, "resolved"); }}
                        title={t("resolve")} className="rounded-md p-1.5 hover:bg-white/60">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleAction(alert.id, "dismissed"); }}
                        title={t("dismiss")} className="rounded-md p-1.5 hover:bg-white/60">
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                </div>
                {isExpanded && (
                  <div className="border-t px-4 py-3 space-y-2">
                    <p className="text-xs font-medium uppercase text-muted-foreground">{t("evidence")}</p>
                    {(Array.isArray(alert.evidence) ? alert.evidence : []).map((ev, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="font-medium text-muted-foreground shrink-0">{ev.label}:</span>
                        <span>{ev.detail}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                      <span className="capitalize">{alert.entityType}</span>
                      <span>·</span>
                      <span className="font-mono">{alert.entityId.slice(0, 8)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
