"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ActionBar } from "@/components/action-bar/action-bar";
import {
  Zap, RefreshCw, AlertCircle, Mail, Phone, Video,
  FileText, MessageSquare, Users, Briefcase,
  ChevronLeft, ChevronRight, Filter, Plus, X, CheckCircle2, Search,
} from "lucide-react";

interface ContactOption { id: string; firstName: string; lastName: string; email: string; }
interface LeadOption   { id: string; firstName: string; lastName: string; email: string; }

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
  createdBy?: string;
  relatedTo?: string;
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
          {activity.relatedTo && (
            <span className="flex items-center gap-1 text-muted-foreground">Related: {activity.relatedTo}</span>
          )}
          {activity.createdBy && (
            <span className="flex items-center gap-1 text-muted-foreground">By: {activity.createdBy}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Log Activity Modal ────────────────────────────────────────────────────────

function ContactLeadSearch({ onSelect }: { onSelect: (item: { id: string; name: string; email: string; type: "contact" | "lead" }) => void }) {
  const t = useTranslations("activities");
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<{ id: string; firstName: string; lastName: string; email: string; _type: "contact" | "lead" }[]>([]);
  const [open, setOpen]       = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const [cr, lr] = await Promise.all([
          api.get("/api/v1/contacts?limit=5&search=" + encodeURIComponent(query)).then((r) => r.json()),
          api.get("/api/v1/leads?limit=5&search=" + encodeURIComponent(query)).then((r) => r.json()),
        ]);
        const contacts = (cr.data ?? []).map((c: ContactOption) => ({ ...c, _type: "contact" as const }));
        const leads    = (lr.data ?? []).map((l: LeadOption)   => ({ ...l, _type: "lead" as const }));
        setResults([...contacts, ...leads]);
        setOpen(true);
      } catch { setResults([]); }
    }, 300);
  }, [query]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input value={query} onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={t("searchContactsOrLeads")}
        className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 z-10 w-full rounded-xl border bg-card shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {results.map((r) => (
            <button key={r._type + r.id} type="button"
              onClick={() => { onSelect({ id: r.id, name: r.firstName + " " + r.lastName, email: r.email, type: r._type }); setQuery(""); setOpen(false); }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors">
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium",
                r._type === "contact" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700")}>
                {r._type === "contact" ? t("contact") : t("lead")}
              </span>
              <span className="text-sm font-medium">{r.firstName} {r.lastName}</span>
              <span className="text-xs text-muted-foreground ml-auto">{r.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LogActivityModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const [type, setType]       = useState<ActivityType>("call");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 16));
  const [duration, setDur]    = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);
  const [linkedEntity, setLinkedEntity] = useState<{ id: string; name: string; email: string; type: "contact" | "lead" } | null>(null);
  const [linkedDeal, setLinkedDeal]     = useState<{ id: string; name: string; stage: string } | null>(null);
  const [dealOptions, setDealOptions]   = useState<{ id: string; name: string; stage: string }[]>([]);
  const [dealOpen, setDealOpen]         = useState(false);

  useEffect(() => {
    if (!linkedEntity) { setDealOptions([]); setLinkedDeal(null); return; }
    api.get("/api/v1/deals?limit=50")
      .then((r) => r.json())
      .then((j) => {
        setDealOptions(
          (j.data ?? []).filter((d: { stage: string }) =>
            !["closed_won", "closed_lost"].includes(d.stage)
          )
        );
      })
      .catch(() => {});
  }, [linkedEntity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        type,
        subject: subject || undefined,
        summary: summary || undefined,
        occurredAt: new Date(date).toISOString(),
        durationSeconds: duration ? parseInt(duration) * 60 : undefined,
        source: "user",
      };
      if (linkedEntity) {
        if (linkedEntity.type === "contact") body.contactId = linkedEntity.id;
        else body.leadId = linkedEntity.id;
      }
      if (linkedDeal) body.dealId = linkedDeal.id;
      const res = await api.post("/api/v1/activities", body);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? t("failedToLog"));
        return;
      }
      setDone(true);
      onCreated();
      setTimeout(onClose, 1200);
    } catch {
      setError(t("networkError"));
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
            <h2 className="font-semibold">{t("logActivity")}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Contact / Lead link */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("linkedContactOrLead")}</label>
            {linkedEntity ? (
              <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <div>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium mr-2",
                    linkedEntity.type === "contact" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700")}>
                    {linkedEntity.type === "contact" ? t("contact") : t("lead")}
                  </span>
                  <span className="text-sm font-medium">{linkedEntity.name}</span>
                </div>
                <button type="button" onClick={() => setLinkedEntity(null)} className="text-muted-foreground hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <ContactLeadSearch onSelect={setLinkedEntity} />
            )}
          </div>

          {/* Opportunity link — appears after a contact/lead is selected */}
          {linkedEntity && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("linkToOpportunity")} <span className="text-muted-foreground font-normal">({tc("optional")})</span></label>
              {linkedDeal ? (
                <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{linkedDeal.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{linkedDeal.stage.replace("_", " ")}</p>
                  </div>
                  <button type="button" onClick={() => setLinkedDeal(null)} className="text-muted-foreground hover:text-red-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <button type="button"
                    onClick={() => setDealOpen((o) => !o)}
                    className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-left text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                    {dealOptions.length === 0 ? t("noOpenOpportunities") : t("selectOpportunity")}
                  </button>
                  {dealOpen && dealOptions.length > 0 && (
                    <div className="absolute top-full mt-1 z-10 w-full rounded-xl border bg-card shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                      {dealOptions.map((d) => (
                        <button key={d.id} type="button"
                          onClick={() => { setLinkedDeal(d); setDealOpen(false); }}
                          className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted transition-colors">
                          <Briefcase className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{d.name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{d.stage.replace("_", " ")}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Type selector */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("type")}</label>
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
            <label className="mb-1.5 block text-sm font-medium">{t("subject")}</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder={type === "call" ? t("subjectPlaceholderCall") : type === "meeting" ? t("subjectPlaceholderMeeting") : t("subjectPlaceholderDefault")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("notesSummary")}</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3}
              placeholder={t("notesPlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("dateTime")}</label>
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {(type === "call" || type === "meeting") && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t("durationMinutes")}</label>
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
              <CheckCircle2 className="h-4 w-4" /> {t("activityLogged")}
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
              {loading ? t("saving") : t("logActivity")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TYPE_FILTER_KEYS: { key: ActivityType | "all"; labelKey: string }[] = [
  { key: "all",      labelKey: "filterAll"      },
  { key: "email",    labelKey: "filterEmails"   },
  { key: "meeting",  labelKey: "filterMeetings" },
  { key: "call",     labelKey: "filterCalls"    },
  { key: "document", labelKey: "filterDocs"     },
];

const PAGE_SIZE = 50;

export default function ActivitiesPage() {
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const [activities, setActivities] = useState<Activity[]>([]);
  // cursors[0] = undefined (first page), cursors[n] = `before` cursor for page n+1
  const [cursors, setCursors]       = useState<(string | undefined)[]>([undefined]);
  const [pageIdx, setPageIdx]       = useState(0);   // index into cursors array
  const [hasMore, setHasMore]       = useState(false);
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all");
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showAdd, setShowAdd]       = useState(false);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (typeFilter !== "all") params.set("type", typeFilter);
      const cursor = cursors[pageIdx];
      if (cursor) params.set("before", cursor);
      const res = await api.get(`/api/v1/activities?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setActivities(json.data ?? []);
      setHasMore(json.pagination?.hasMore ?? false);
      // Store the nextCursor for the next page at position pageIdx+1
      if (json.pagination?.nextCursor) {
        setCursors((prev) => {
          const next = [...prev];
          next[pageIdx + 1] = json.pagination.nextCursor;
          return next;
        });
      }
    } catch (e: any) {
      setError(e.message ?? t("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [pageIdx, cursors, typeFilter, t]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  // Reset to page 1 when filter changes
  const handleTypeFilter = (t: ActivityType | "all") => {
    setTypeFilter(t);
    setPageIdx(0);
    setCursors([undefined]);
  };

  const goNext = () => setPageIdx((i) => i + 1);
  const goPrev = () => setPageIdx((i) => Math.max(0, i - 1));

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
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <ActionBar context="activities" />
          {!loading && activities.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {activities.length}{hasMore ? "+" : ""} {t("shown")}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={fetchActivities} disabled={loading}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {tc("refresh")}
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> {t("logActivity")}
          </button>
        </div>
      </div>

      {showAdd && <LogActivityModal onClose={() => setShowAdd(false)} onCreated={fetchActivities} />}

      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {TYPE_FILTER_KEYS.map(({ key, labelKey }) => (
            <button key={key} onClick={() => handleTypeFilter(key)}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors",
                typeFilter === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t(labelKey)}
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
                ? t("noFilteredActivities", { type: typeFilter })
                : t("noActivities")}
            </p>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> {t("logFirstActivity")}
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

      {(pageIdx > 0 || hasMore) && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">{t("page", { page: pageIdx + 1 })}</p>
          <div className="flex gap-2">
            <button onClick={goPrev} disabled={pageIdx === 0 || loading}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> {tc("previous")}
            </button>
            <button onClick={goNext} disabled={!hasMore || loading}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">
              {tc("next")} <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
