"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Bell, Check, CheckCheck, Filter, RefreshCw, Settings,
  AlertCircle, Briefcase, CheckSquare, Zap, Mail, Phone,
  BarChart3, Calendar, Shield, Layers, TrendingUp, X,
  Trash2, Archive,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: "low" | "normal" | "high";
  read_at: string | null;
  created_at: string;
  action_url?: string;
}

const TYPE_CONFIG: Record<string, { icon: React.FC<{ className?: string }>; color: string; bg: string }> = {
  ai_review:      { icon: Zap,          color: "text-purple-600", bg: "bg-purple-100" },
  ai_insight:     { icon: Zap,          color: "text-purple-600", bg: "bg-purple-50" },
  deal_alert:     { icon: AlertCircle,  color: "text-orange-600", bg: "bg-orange-100" },
  deal_stage:     { icon: TrendingUp,   color: "text-green-600",  bg: "bg-green-100" },
  task_due:       { icon: CheckSquare,  color: "text-blue-600",   bg: "bg-blue-100" },
  sequence:       { icon: Layers,       color: "text-indigo-600", bg: "bg-indigo-100" },
  call_recording: { icon: Phone,        color: "text-emerald-600",bg: "bg-emerald-100" },
  forecast:       { icon: BarChart3,    color: "text-amber-600",  bg: "bg-amber-100" },
  email:          { icon: Mail,         color: "text-blue-600",   bg: "bg-blue-100" },
  meeting:        { icon: Calendar,     color: "text-violet-600", bg: "bg-violet-100" },
  security:       { icon: Shield,       color: "text-red-600",    bg: "bg-red-100" },
};

function formatTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const tc = useTranslations("common");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread" | "high">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter === "unread") params.set("unreadOnly", "true");
      params.set("limit", "100");
      const res = await api.get(`/api/v1/notifications?${params}`);
      const json = await res.json();
      setNotifications(json.data?.notifications ?? []);
    } catch {
      // Demo data
      setNotifications([
        { id: "n1", type: "ai_review", title: "7 extractions need review", body: "AI confidence 75-90% on new emails from Acme Corp and TechStart", priority: "normal", read_at: null, created_at: new Date(Date.now() - 120000).toISOString(), action_url: "/review" },
        { id: "n2", type: "deal_alert", title: "Acme Corp — deal stalling", body: "No activity in 8 days, reality score dropped 15 points to 57", priority: "high", read_at: null, created_at: new Date(Date.now() - 3600000).toISOString(), action_url: "/pipeline" },
        { id: "n3", type: "task_due", title: "Follow-up with TechStart due", body: "Send proposal revision — due today at 5:00 PM", priority: "high", read_at: null, created_at: new Date(Date.now() - 10800000).toISOString(), action_url: "/tasks" },
        { id: "n4", type: "deal_stage", title: "Globex moved to Negotiation", body: "Stage updated by Sarah Kim — deal value $380,000", priority: "normal", read_at: new Date(Date.now() - 14400000).toISOString(), created_at: new Date(Date.now() - 18000000).toISOString(), action_url: "/pipeline" },
        { id: "n5", type: "ai_insight", title: "Budget confirmed — Acme Corp", body: "Auto-detected budget of $450K in latest email thread with CFO", priority: "normal", read_at: new Date(Date.now() - 86400000).toISOString(), created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: "n6", type: "sequence", title: "Sequence 'Q1 Outbound' completed", body: "42 contacts completed, 8 replied (19%), 3 meetings booked", priority: "normal", read_at: null, created_at: new Date(Date.now() - 7200000).toISOString(), action_url: "/sequences" },
        { id: "n7", type: "call_recording", title: "Call recording transcribed", body: "Your 5m 40s call with John Smith (Acme Corp) has been transcribed and scored", priority: "low", read_at: null, created_at: new Date(Date.now() - 5400000).toISOString(), action_url: "/calling" },
        { id: "n8", type: "forecast", title: "Forecast submission due tomorrow", body: "Q1 2026 forecast deadline is March 9 — your commit is $570K vs $500K quota", priority: "high", read_at: null, created_at: new Date(Date.now() - 1800000).toISOString(), action_url: "/forecasting" },
        { id: "n9", type: "email", title: "Reply from Lisa Park", body: "Re: Platform Demo Follow-up — 'Thanks, we'd like to move forward with...'", priority: "normal", read_at: null, created_at: new Date(Date.now() - 900000).toISOString() },
        { id: "n10", type: "meeting", title: "Meeting in 30 minutes", body: "QBR with Umbrella Co — Join link ready", priority: "high", read_at: null, created_at: new Date(Date.now() - 600000).toISOString() },
        { id: "n11", type: "security", title: "New login from new device", body: "Chrome on macOS — San Francisco, CA", priority: "normal", read_at: null, created_at: new Date(Date.now() - 43200000).toISOString() },
        { id: "n12", type: "ai_review", title: "3 new contacts auto-created", body: "From yesterday's email threads — review for accuracy", priority: "low", read_at: new Date().toISOString(), created_at: new Date(Date.now() - 172800000).toISOString(), action_url: "/review" },
      ]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markRead = async (id: string) => {
    setNotifications((ns) => ns.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    try { await api.patch(`/api/v1/notifications/${id}/read`, {}); } catch { /* ok */ }
  };

  const markAllRead = async () => {
    setNotifications((ns) => ns.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    try { await api.post("/api/v1/notifications/mark-all-read", {}); } catch { /* ok */ }
  };

  const filtered = notifications.filter((n) => {
    if (filter === "unread" && n.read_at) return false;
    if (filter === "high" && n.priority !== "high") return false;
    if (typeFilter !== "all" && n.type !== typeFilter) return false;
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const highPriorityCount = notifications.filter((n) => n.priority === "high" && !n.read_at).length;

  const uniqueTypes = [...new Set(notifications.map((n) => n.type))];

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">{unreadCount}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
              <CheckCheck className="h-3.5 w-3.5" /> {t("markAllRead")}
            </button>
          )}
          <button onClick={fetchNotifications} disabled={loading} className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <Link href="/settings?tab=notifications" className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted">
            <Settings className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {([
            { key: "all", label: t("allTab") },
            { key: "unread", label: t("unreadTab", { count: unreadCount }) },
            { key: "high", label: t("priorityTab", { count: highPriorityCount }) },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                filter === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-1">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border-0 bg-transparent px-1 py-0.5 text-xs text-muted-foreground focus:outline-none focus:ring-0"
          >
            <option value="all">{t("allTypes")}</option>
            {uniqueTypes.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Notification list */}
      <div className="flex-1 space-y-1">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted/60" />
                </div>
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bell className="h-12 w-12 text-muted-foreground/20" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">{t("empty")}</p>
            <p className="text-xs text-muted-foreground/70">{t("caughtUp")}</p>
          </div>
        ) : (
          filtered.map((n) => {
            const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.ai_insight;
            const Icon = cfg.icon;
            const isUnread = !n.read_at;

            return (
              <div
                key={n.id}
                onClick={() => { if (isUnread) markRead(n.id); }}
                className={cn(
                  "group flex items-start gap-3 rounded-lg border p-4 transition-colors cursor-pointer",
                  isUnread ? "border-primary/20 bg-primary/[0.03] hover:bg-primary/[0.06]" : "border-border hover:bg-muted/40",
                )}
              >
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", cfg.bg)}>
                  <Icon className={cn("h-4 w-4", cfg.color)} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("text-sm", isUnread ? "font-semibold" : "font-medium")}>{n.title}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      {n.priority === "high" && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">Priority</span>
                      )}
                      <span className="text-xs text-muted-foreground">{formatTime(n.created_at)}</span>
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                  {n.action_url && (
                    <Link
                      href={n.action_url}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5 inline-block text-xs text-primary hover:underline"
                    >
                      {t("viewDetails")}
                    </Link>
                  )}
                </div>

                {isUnread && (
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
