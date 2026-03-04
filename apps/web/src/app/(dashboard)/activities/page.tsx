"use client";

import { useEffect, useState, useCallback } from "react";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  Zap, RefreshCw, AlertCircle, Mail, Phone, Video,
  FileText, MessageSquare, Users, Briefcase,
  ChevronLeft, ChevronRight, Filter, Plus, X, CheckCircle2,
} from "lucide-react";

type ActivityType = "email" | "call" | "meeting" | "document" | "chat";

interface Participant { name?: string; email: string; }

interface Activity {
  id: string;
  type: ActivityType;
  subject?: string;
  summary?: string;
  sentiment?: "positive" | "neutral" | "negative";
  source: string;
  participants?: Participant[];
  deal?: { id: string; name: string };
  company?: { id: string; name: string };
  occurredAt: string;
  durationSeconds?: number;
}

const ACTIVITY_META: Record<ActivityType, { icon: React.FC<{ className?: string }>; label: string; color: string }> = {
  email:    { icon: Mail,          label: "Email",   color: "bg-blue-100 text-blue-600"   },
  call:     { icon: Phone,         label: "Call",    color: "bg-green-100 text-green-600"  },
  meeting:  { icon: Video,         label: "Meeting", color: "bg-purple-100 text-purple-600"},
  document: { icon: FileText,      label: "Doc",     color: "bg-orange-100 text-orange-600"},
  chat:     { icon: MessageSquare, label: "Chat",    color: "bg-yellow-100 text-yellow-600"},
};

const SOURCE_LABELS: Record<string, string> = {
  gmail: "Gmail", gcal: "Google Calendar", outlook: "Outlook",
  zoom: "Zoom", slack: "Slack", user: "Manual",
};

function SentimentPill({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  const styles: Record<string, string> = {
    positive: "bg-green-100 text-green-700",
    neutral:  "bg-muted text-muted-foreground",
    negative: "bg-red-100 text-red-700",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs capitalize", styles[sentiment] ?? styles.neutral)}>
      {sentiment}
    </span>
  );
}

function formatDuration(secs?: number): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function ActivityRow({ activity }: { activity: Activity }) {
  const meta = ACTIVITY_META[activity.type] ?? ACTIVITY_META.email;
  const Icon = meta.icon;
  return (
    <div className="flex gap-4 py-4">
      <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {activity.subject || `${meta.label} activity`}
            </p>
            {activity.summary && (
              <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{activity.summary}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <SentimentPill sentiment={activity.sentiment} />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeTime(activity.occurredAt)}
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {activity.participants && activity.participants.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {activity.participants.slice(0, 3).map((p) => p.name || p.email.split("@")[0]).join(", ")}
              {activity.participants.length > 3 && ` +${activity.participants.length - 3}`}
            </span>
          )}
          {activity.deal && (
            <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{activity.deal.name}</span>
          )}
          {activity.durationSeconds != null && <span>{formatDuration(activity.durationSeconds)}</span>}
          <span className={cn("rounded-full px-2 py-0.5",
            activity.source === "user" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600")}>
            {SOURCE_LABELS[activity.source] ?? activity.source}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Log Activity Modal ────────────────────────────────────────────────────────

function LogActivityModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType]       = useState<ActivityType>("call");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 16));
  const [duration, setDur]    = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post("/api/v1/activities", {
        type,
        subject: subject || undefined,
        summary: summary || undefined,
        occurredAt: new Date(date).toISOString(),
        durationSeconds: duration ? parseInt(duration) * 60 : undefined,
        source: "user",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? "Failed to log activity");
        return;
      }
      setDone(true);
      onCreated();
      setTimeout(onClose, 1200);
    } catch {
      setError("Network error — please try again");
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
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Log Activity</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Type selector */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Type</label>
            <div className="flex gap-2 flex-wrap">
              {(Object.entries(ACTIVITY_META) as [ActivityType, typeof ACTIVITY_META[ActivityType]][]).map(([key, meta]) => {
                const Icon = meta.icon;
                return (
                  <button key={key} type="button" onClick={() => setType(key)}
                    className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                      type === key ? meta.color + " border-current" : "border-border text-muted-foreground hover:bg-muted")}>
                    <Icon className="h-3 w-3" />{meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder={type === "call" ? "Call with Acme Corp CEO" : type === "meeting" ? "Discovery call — TechStart" : "Subject…"}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Notes / Summary</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3}
              placeholder="Key points discussed, outcomes, next steps…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Date & Time</label>
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {(type === "call" || type === "meeting") && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Duration (minutes)</label>
                <input type="number" min="1" value={duration} onChange={(e) => setDur(e.target.value)}
                  placeholder="30"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Activity logged!
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                loading ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
              {loading ? "Saving…" : "Log Activity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TYPE_FILTERS: { key: ActivityType | "all"; label: string }[] = [
  { key: "all",      label: "All"      },
  { key: "email",    label: "Emails"   },
  { key: "meeting",  label: "Meetings" },
  { key: "call",     label: "Calls"    },
  { key: "document", label: "Docs"     },
];

const PAGE_SIZE = 50;

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all");
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showAdd, setShowAdd]       = useState(false);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await api.get(`/api/v1/activities?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setActivities(json.data ?? []);
      setTotal(json.pagination?.total ?? json.data?.length ?? 0);
    } catch (e: any) {
      setError(e.message ?? "Failed to load activities");
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const grouped: { date: string; items: Activity[] }[] = [];
  for (const activity of activities) {
    const d = new Date(activity.occurredAt).toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric",
    });
    const last = grouped[grouped.length - 1];
    if (last && last.date === d) last.items.push(activity);
    else grouped.push({ date: d, items: [activity] });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Activity Feed</h1>
          {!loading && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {total.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={fetchActivities} disabled={loading}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Log Activity
          </button>
        </div>
      </div>

      {showAdd && <LogActivityModal onClose={() => setShowAdd(false)} onCreated={fetchActivities} />}

      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {TYPE_FILTERS.map(({ key, label }) => (
            <button key={key} onClick={() => { setTypeFilter(key); setPage(1); }}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors",
                typeFilter === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-4 py-4 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Zap className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">
              {typeFilter !== "all"
                ? `No ${typeFilter} activities yet`
                : "No activities yet — connect Gmail or Outlook to start capturing automatically"}
            </p>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> Log your first activity
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {grouped.map(({ date, items }) => (
              <div key={date}>
                <div className="sticky top-0 bg-background/80 backdrop-blur-sm py-2">
                  <p className="text-xs font-semibold text-muted-foreground">{date}</p>
                </div>
                <div className="divide-y divide-border/50">
                  {items.map((activity) => <ActivityRow key={activity.id} activity={activity} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
