"use client";

/**
 * Public meeting booking page. Invitee picks a day, then an open slot, then
 * enters their details to confirm. Slots come from the gateway as UTC ISO
 * strings; we render them in the link's timezone.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Clock, Globe, Loader2, CheckCircle2, ArrowLeft, CalendarX } from "lucide-react";

interface LinkInfo { slug: string; title: string; description: string | null; durationMinutes: number; timezone: string; ownerName: string }
interface Slot { start: string; end: string }

function fmtDayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function fmtDayLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}
function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [link, setLink] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Slot | null>(null);

  useEffect(() => {
    fetch(`/api/book/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) { setNotFound(true); return; }
        const d = await r.json().catch(() => ({}));
        if (d?.success) setLink(d.data); else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!link) return;
    setSlotsLoading(true);
    fetch(`/api/book/${encodeURIComponent(slug)}/slots`)
      .then((r) => r.json())
      .then((d) => setSlots(d?.data?.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [link, slug]);

  const tz = link?.timezone ?? "UTC";

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = fmtDayKey(s.start, tz);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return map;
  }, [slots, tz]);

  const days = useMemo(() => [...byDay.keys()].sort(), [byDay]);

  useEffect(() => { if (!activeDay && days.length) setActiveDay(days[0]); }, [days, activeDay]);

  const book = useCallback(async () => {
    if (!chosen) return;
    setBooking(true);
    setError(null);
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, notes: notes || null, start: chosen.start }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.error?.message ?? "Couldn't book that time. Please try another."); return; }
      setConfirmed(chosen);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBooking(false);
    }
  }, [chosen, name, email, notes, slug]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (notFound || !link) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <CalendarX className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Booking link not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">This scheduling link is inactive or doesn&apos;t exist.</p>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-600" />
        <h1 className="text-xl font-bold">You&apos;re booked!</h1>
        <div className="w-full rounded-xl border border-border bg-card p-4 text-left">
          <p className="font-medium">{link.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Calendar className="h-3.5 w-3.5" /> {fmtDayLabel(confirmed.start, tz)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {fmtTime(confirmed.start, tz)}–{fmtTime(confirmed.end, tz)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground"><Globe className="h-3.5 w-3.5" /> {tz}</p>
        </div>
        <p className="text-sm text-muted-foreground">A confirmation has been recorded for {link.ownerName}.</p>
      </div>
    );
  }

  const daySlots = activeDay ? byDay.get(activeDay) ?? [] : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid md:grid-cols-[280px_1fr]">
        {/* Left: meeting summary */}
        <div className="border-b border-border bg-muted/30 p-6 md:border-b-0 md:border-r">
          <p className="text-sm font-medium text-muted-foreground">{link.ownerName}</p>
          <h1 className="mt-1 text-xl font-bold">{link.title}</h1>
          {link.description && <p className="mt-3 text-sm text-muted-foreground">{link.description}</p>}
          <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
            <p className="flex items-center gap-2"><Clock className="h-4 w-4" /> {link.durationMinutes} min</p>
            <p className="flex items-center gap-2"><Globe className="h-4 w-4" /> {tz}</p>
          </div>
        </div>

        {/* Right: pick a slot / enter details */}
        <div className="p-6">
          {chosen ? (
            <div>
              <button onClick={() => { setChosen(null); setError(null); }} className="mb-4 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary">
                <ArrowLeft className="h-4 w-4" /> Back to times
              </button>
              <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <span className="font-medium">{fmtDayLabel(chosen.start, tz)}</span> · {fmtTime(chosen.start, tz)}–{fmtTime(chosen.end, tz)}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes (optional)</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button onClick={book} disabled={booking || !name || !email}
                  className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                  {booking ? "Booking…" : "Confirm booking"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="mb-3 flex items-center gap-2 font-semibold"><Calendar className="h-4 w-4 text-primary" /> Select a time</h2>
              {slotsLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : days.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No open times in the next two weeks. Please check back later.</p>
              ) : (
                <>
                  <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                    {days.map((d) => {
                      const label = fmtDayLabel(byDay.get(d)![0].start, tz);
                      return (
                        <button key={d} onClick={() => setActiveDay(d)}
                          className={`shrink-0 rounded-lg border px-3 py-2 text-center text-xs font-medium transition-colors ${activeDay === d ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                          {label}<span className="mt-0.5 block text-[10px] text-muted-foreground">{byDay.get(d)!.length} slots</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {daySlots.map((s) => (
                      <button key={s.start} onClick={() => setChosen(s)}
                        className="rounded-lg border border-border px-2 py-2 text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5">
                        {fmtTime(s.start, tz)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">Powered by NexCRM</p>
    </div>
  );
}
