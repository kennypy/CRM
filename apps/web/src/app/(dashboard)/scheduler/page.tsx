"use client";

/**
 * Meetings scheduler management. Reps create booking links (availability,
 * duration, timezone) and share the public /book/:slug URL; they can also see
 * upcoming bookings per link.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CalendarClock, Plus, Copy, Check, ExternalLink, Trash2, X, Users2,
  Loader2, AlertCircle, Power,
} from "lucide-react";

interface Availability { weekdays: number[]; startTime: string; endTime: string }
interface BookingLink {
  id: string; slug: string; title: string; description: string | null;
  durationMinutes: number; timezone: string; availability: Availability;
  bufferMinutes: number; active: boolean; bookingCount: number;
}
interface Booking { id: string; inviteeName: string; inviteeEmail: string; inviteeNotes: string | null; startTime: string; endTime: string }

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DURATIONS = [15, 30, 45, 60];
const COMMON_TZ = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"];

function detectedTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function LinkEditor({ link, onClose, onSaved }: { link: BookingLink | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(link?.title ?? "");
  const [description, setDescription] = useState(link?.description ?? "");
  const [duration, setDuration] = useState(link?.durationMinutes ?? 30);
  const [timezone, setTimezone] = useState(link?.timezone ?? detectedTz());
  const [weekdays, setWeekdays] = useState<number[]>(link?.availability?.weekdays ?? [1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState(link?.availability?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(link?.availability?.endTime ?? "17:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tzOptions = Array.from(new Set([detectedTz(), ...COMMON_TZ, ...(link ? [link.timezone] : [])]));

  const toggleDay = (d: number) => setWeekdays((w) => w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort());

  const save = async () => {
    if (!weekdays.length) { setError("Pick at least one available weekday."); return; }
    if (startTime >= endTime) { setError("End time must be after start time."); return; }
    setSaving(true);
    setError(null);
    const payload = { title, description: description || null, durationMinutes: duration, timezone, availability: { weekdays, startTime, endTime } };
    try {
      const res = link ? await api.patch(`/api/v1/booking-links/${link.id}`, payload) : await api.post("/api/v1/booking-links", payload);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.error?.message ?? "Couldn't save the link."); return; }
      onSaved();
    } catch { setError("Network error — please try again."); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> {link ? "Edit booking link" : "New booking link"}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intro call" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this meeting is about" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Duration</label>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timezone</label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                {tzOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available days</label>
            <div className="flex gap-1.5">
              {WEEKDAYS.map((w, i) => (
                <button key={i} onClick={() => toggleDay(i)} type="button"
                  className={cn("flex-1 rounded-lg border px-1 py-2 text-xs font-medium transition-colors", weekdays.includes(i) ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")}>
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">End time</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Cancel</button>
          <button onClick={save} disabled={saving || !title} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {saving ? "Saving…" : link ? "Save changes" : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingsModal({ link, onClose }: { link: BookingLink; onClose: () => void }) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  useEffect(() => {
    api.get(`/api/v1/booking-links/${link.id}/bookings`).then((r) => r.json()).then((d) => setBookings(d?.data ?? [])).catch(() => setBookings([]));
  }, [link.id]);
  const fmt = (iso: string) => new Intl.DateTimeFormat(undefined, { timeZone: link.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><Users2 className="h-4 w-4 text-primary" /> Upcoming bookings</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        {bookings === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : bookings.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No upcoming bookings yet.</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {bookings.map((b) => (
              <div key={b.id} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{b.inviteeName} <span className="font-normal text-muted-foreground">· {b.inviteeEmail}</span></p>
                <p className="text-xs text-muted-foreground">{fmt(b.startTime)} ({link.timezone})</p>
                {b.inviteeNotes && <p className="mt-1 text-xs text-muted-foreground">“{b.inviteeNotes}”</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkCard({ link, onEdit, onDelete, onToggle, onView }: {
  link: BookingLink; onEdit: () => void; onDelete: () => void; onToggle: () => void; onView: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/book/${link.slug}` : `/book/${link.slug}`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* http */ } };

  return (
    <div className={cn("rounded-xl border p-4", link.active ? "border-border bg-card" : "border-dashed border-border bg-muted/30")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{link.title}</span>
            {!link.active && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">inactive</span>}
          </div>
          <p className="text-xs text-muted-foreground">{link.durationMinutes} min · {link.timezone} · {link.bookingCount} booked</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onToggle} title={link.active ? "Deactivate" : "Activate"} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Power className="h-4 w-4" /></button>
          <button onClick={onDelete} title="Delete" className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
        <button onClick={copy} className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-border p-1 hover:bg-muted"><ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={onEdit} className="flex-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Edit</button>
        <button onClick={onView} className="flex-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">View bookings</button>
      </div>
    </div>
  );
}

export default function SchedulerPage() {
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BookingLink | null | undefined>(undefined);
  const [viewing, setViewing] = useState<BookingLink | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/api/v1/booking-links");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.error?.message ?? "Couldn't load booking links."); return; }
      setLinks(d.data ?? []);
    } catch { setError("Network error — could not load booking links."); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (l: BookingLink) => {
    setLinks((ls) => ls.map((x) => x.id === l.id ? { ...x, active: !x.active } : x));
    await api.patch(`/api/v1/booking-links/${l.id}`, { active: !l.active });
    load();
  };
  const remove = async (l: BookingLink) => {
    if (!confirm(`Delete "${l.title}"? Its bookings will be removed too.`)) return;
    setLinks((ls) => ls.filter((x) => x.id !== l.id));
    await api.delete(`/api/v1/booking-links/${l.id}`);
    load();
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold"><CalendarClock className="h-5 w-5 text-primary" /> Meeting Scheduler</h1>
          <p className="text-sm text-muted-foreground">Share a booking link and let people pick an open time from your availability.</p>
        </div>
        <button onClick={() => setEditing(null)} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New booking link
        </button>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-12 text-center">
          <AlertCircle className="h-8 w-8 text-red-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <button onClick={load} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Retry</button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No booking links yet. Create one to start taking meetings.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((l) => (
            <LinkCard key={l.id} link={l}
              onEdit={() => setEditing(l)} onDelete={() => remove(l)} onToggle={() => toggle(l)} onView={() => setViewing(l)} />
          ))}
        </div>
      )}

      {editing !== undefined && <LinkEditor link={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); load(); }} />}
      {viewing && <BookingsModal link={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
