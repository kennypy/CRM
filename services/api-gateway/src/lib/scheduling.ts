/**
 * Availability / slot computation for the meetings scheduler.
 *
 * Booking links store weekly availability as wall-clock times in a named IANA
 * timezone. We generate concrete UTC slot instants for a date range, subtracting
 * ones that are in the past or already booked. Timezone math uses Intl (no
 * external date library); DST-transition edge slots are treated single-pass,
 * which is fine for a booking scheduler.
 */

export interface Availability {
  weekdays: number[];   // 0=Sun … 6=Sat, interpreted in the link's timezone
  startTime: string;    // "HH:MM"
  endTime: string;      // "HH:MM"
}

/**
 * Minutes to add to a UTC instant to get local wall-clock time in `timeZone`
 * (i.e. local = utc + offset). Positive east of UTC.
 */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(at);
    const map: Record<string, number> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = parseInt(p.value, 10);
    // Intl may render hour "24" at midnight — normalise.
    const hour = map.hour === 24 ? 0 : map.hour;
    const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return 0; // invalid timezone → treat as UTC
  }
}

/** Convert a wall-clock time (y-m-d h:m) in `timeZone` to a UTC Date. */
export function zonedWallTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMinutes(timeZone, new Date(naiveUtc));
  return new Date(naiveUtc - offset * 60000);
}

/** The weekday (0=Sun) that a UTC instant falls on, in `timeZone`. */
export function zonedWeekday(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function parseHM(s: string): [number, number] {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}

/**
 * Generate available slot start-times (as UTC ISO strings) for the given date
 * range, honouring the link's weekly availability, duration and buffer, and
 * excluding past times and already-booked starts.
 *
 * @param fromDate/toDate  inclusive YYYY-MM-DD wall-clock dates in the link tz
 * @param now              current instant (slots before now+lead are dropped)
 * @param bookedStartsMs   set of already-booked slot start times (epoch ms)
 */
export function generateSlots(opts: {
  availability: Availability;
  durationMinutes: number;
  bufferMinutes: number;
  timeZone: string;
  fromDate: string;
  toDate: string;
  now: Date;
  bookedStartsMs: Set<number>;
  maxSlots?: number;
}): { start: string; end: string }[] {
  const { availability, durationMinutes, bufferMinutes, timeZone, fromDate, toDate, now, bookedStartsMs } = opts;
  const maxSlots = opts.maxSlots ?? 500;
  const step = durationMinutes + bufferMinutes;
  const weekdays = new Set(availability.weekdays ?? []);
  const [sh, sm] = parseHM(availability.startTime ?? "09:00");
  const [eh, em] = parseHM(availability.endTime ?? "17:00");
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  // Small lead time so invitees can't book something starting in 2 minutes.
  const earliest = now.getTime() + 30 * 60000;

  const out: { start: string; end: string }[] = [];
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  // Iterate calendar days using a UTC anchor at noon (avoids DST midnight drift).
  let cursor = Date.UTC(fy, fm - 1, fd, 12);
  const end = Date.UTC(ty, tm - 1, td, 12);

  while (cursor <= end && out.length < maxSlots) {
    const dayAnchor = new Date(cursor);
    const y = dayAnchor.getUTCFullYear();
    const mo = dayAnchor.getUTCMonth() + 1;
    const d = dayAnchor.getUTCDate();

    if (weekdays.has(zonedWeekday(timeZone, dayAnchor))) {
      for (let mins = startMinutes; mins + durationMinutes <= endMinutes; mins += step) {
        const slotStart = zonedWallTimeToUtc(y, mo, d, Math.floor(mins / 60), mins % 60, timeZone);
        const ms = slotStart.getTime();
        if (ms < earliest) continue;
        if (bookedStartsMs.has(ms)) continue;
        out.push({
          start: slotStart.toISOString(),
          end: new Date(ms + durationMinutes * 60000).toISOString(),
        });
        if (out.length >= maxSlots) break;
      }
    }
    cursor += 24 * 3600 * 1000;
  }
  return out;
}
