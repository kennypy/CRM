"use client";

/**
 * Audit-log viewer — admin-only, read-only view over the CRM event stream
 * (`crm_events`). Every contact/company/deal/activity mutation lands here.
 * Filter by entity type, event type, source, actor, free-text and date range;
 * expand any row to inspect the raw event payload. Paginated via a keyset
 * cursor ("Load more" fetches the next older page).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import {
  ScrollText, RefreshCw, Search, ChevronDown, ChevronRight,
  Filter, X, ShieldAlert, User as UserIcon, Cpu,
} from "lucide-react";

interface AuditEvent {
  id: string;
  eventType: string;
  source: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: unknown;
  createdAt: string;
}

interface Facets {
  entityTypes: string[];
  eventTypes: string[];
  sources: string[];
  actors: { id: string; name: string; email: string }[];
}

const EVENT_TONE = (eventType: string): string => {
  if (eventType.includes("delete") || eventType.includes("lost")) return "bg-red-100 text-red-800";
  if (eventType.includes("create") || eventType.includes("won")) return "bg-green-100 text-green-800";
  if (eventType.includes("update") || eventType.includes("change")) return "bg-blue-100 text-blue-800";
  return "bg-gray-100 text-gray-700";
};

function EventRow({ ev }: { ev: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const hasPayload = !!(ev.payload && Object.keys(ev.payload as object).length > 0);

  return (
    <>
      <tr
        className={cn("border-b border-border/60 hover:bg-muted/40 transition-colors", hasPayload && "cursor-pointer")}
        onClick={() => hasPayload && setOpen((v) => !v)}
      >
        <td className="py-2.5 pl-3 pr-2 align-top">
          {hasPayload ? (
            open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : <span className="inline-block h-3.5 w-3.5" />}
        </td>
        <td className="py-2.5 pr-3 align-top whitespace-nowrap text-xs text-muted-foreground" title={new Date(ev.createdAt).toLocaleString()}>
          {formatRelativeTime(ev.createdAt)}
        </td>
        <td className="py-2.5 pr-3 align-top">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", EVENT_TONE(ev.eventType))}>
            {ev.eventType}
          </span>
        </td>
        <td className="py-2.5 pr-3 align-top">
          <span className="text-sm capitalize">{ev.entityType}</span>
          <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">{ev.entityId}</div>
        </td>
        <td className="py-2.5 pr-3 align-top">
          <div className="flex items-center gap-1.5">
            {ev.actorName ? <UserIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            <div className="min-w-0">
              <div className="text-sm truncate">{ev.actorName ?? "System"}</div>
              {ev.actorEmail && <div className="text-[10px] text-muted-foreground truncate">{ev.actorEmail}</div>}
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-3 align-top">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{ev.source}</span>
        </td>
      </tr>
      {open && hasPayload && (
        <tr className="border-b border-border/60 bg-muted/30">
          <td />
          <td colSpan={5} className="py-3 pr-4">
            <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-background p-3 text-xs leading-relaxed">
              {JSON.stringify(ev.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditLogPage() {
  const { isAdmin } = usePermissions();

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [eventType, setEventType] = useState("");
  const [source, setSource] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (entityType) p.set("entityType", entityType);
    if (eventType) p.set("eventType", eventType);
    if (source) p.set("source", source);
    if (actorId) p.set("actorId", actorId);
    if (from) p.set("from", new Date(from).toISOString());
    if (to) p.set("to", new Date(to + "T23:59:59").toISOString());
    p.set("limit", "50");
    return p.toString();
  }, [search, entityType, eventType, source, actorId, from, to]);

  const load = useCallback(async (append = false, before?: string) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams(queryString);
      if (before) p.set("before", before);
      const res = await api.get(`/api/v1/audit-log?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "Couldn't load the audit log.");
        return;
      }
      const rows: AuditEvent[] = data.data ?? [];
      setEvents((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(Boolean(data.pagination?.hasMore));
      setCursor(data.pagination?.nextCursor ?? null);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [queryString]);

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/api/v1/audit-log/facets")
      .then((r) => r.json())
      .then((d) => { if (d?.success) setFacets(d.data); })
      .catch(() => { /* filters degrade gracefully to free-text only */ });
  }, [isAdmin]);

  // Debounce filter changes into a fresh (non-appending) load.
  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => load(false), 250);
    return () => clearTimeout(t);
  }, [isAdmin, load]);

  const activeFilters = [entityType, eventType, source, actorId, from, to, search].filter(Boolean).length;
  const clearFilters = () => {
    setSearch(""); setEntityType(""); setEventType(""); setSource(""); setActorId(""); setFrom(""); setTo("");
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Admins only</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The audit log is restricted to administrators. Ask your workspace admin if you need access.
        </p>
      </div>
    );
  }

  const selectCls = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ScrollText className="h-5 w-5 text-primary" /> Audit Log
          </h1>
          <p className="text-sm text-muted-foreground">Every change across the workspace, newest first.</p>
        </div>
        <button
          onClick={() => load(false)}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search event, entity or payload…"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={selectCls}>
          <option value="">All entities</option>
          {facets?.entityTypes.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>

        <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={selectCls}>
          <option value="">All events</option>
          {facets?.eventTypes.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>

        <select value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
          <option value="">All sources</option>
          {facets?.sources.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>

        <select value={actorId} onChange={(e) => setActorId(e.target.value)} className={selectCls}>
          <option value="">All actors</option>
          {facets?.actors.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
        </select>

        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} title="From date" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} title="To date" />

        {activeFilters > 0 && (
          <button onClick={clearFilters} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted">
            <X className="h-3.5 w-3.5" /> Clear ({activeFilters})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden rounded-xl border border-border bg-card">
        {error ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <ShieldAlert className="h-8 w-8 text-red-500" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <Filter className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No events match these filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 py-2 pl-3" />
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Entity</th>
                  <th className="py-2 pr-3 font-medium">Actor</th>
                  <th className="py-2 pr-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => <EventRow key={ev.id} ev={ev} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center">
          <button
            onClick={() => cursor && load(true, cursor)}
            disabled={loadingMore}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            {loadingMore ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Load older events
          </button>
        </div>
      )}
    </div>
  );
}
