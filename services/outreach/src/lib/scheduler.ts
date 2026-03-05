/**
 * Time-zone-aware send scheduling for sequence steps.
 *
 * Strategy:
 *  1. "contact" mode  — use the contact's timezone (from enrollment record).
 *  2. "rep" mode      — use the sending rep's timezone (from tenant settings or UTC).
 *  3. "fixed" mode    — use a fixed IANA timezone stored in sequence.settings.fixed_tz.
 *
 * Business-hours window: configurable per sequence (default Mon–Fri 09:00–17:00).
 * If the computed send time falls outside the window, advance to the next valid slot.
 */

/** Parses a time string "HH:MM" into [hours, minutes]. */
function parseTime(t: string): [number, number] {
  const [h, m] = t.split(":").map(Number);
  return [h ?? 9, m ?? 0];
}

export interface ScheduleSettings {
  timezoneMode: "contact" | "rep" | "fixed";
  fixedTz:      string;    // IANA tz (used only when mode = 'fixed')
  sendDays:     number[];  // 1=Mon … 7=Sun (ISO weekday)
  sendStart:    string;    // "HH:MM"
  sendEnd:      string;    // "HH:MM"
}

const DEFAULT_SETTINGS: ScheduleSettings = {
  timezoneMode: "contact",
  fixedTz:      "UTC",
  sendDays:     [1, 2, 3, 4, 5],
  sendStart:    "09:00",
  sendEnd:      "17:00",
};

/**
 * Compute the next scheduled_at timestamp for a sequence step.
 *
 * @param baseDate      The reference date (enrollment date for step 1, or previous step's executed_at)
 * @param dayOffset     Days to add after baseDate
 * @param timeOfDay     Preferred send time "HH:MM" in the resolved timezone
 * @param contactTz     Contact's IANA timezone string
 * @param settings      Sequence schedule settings (partial, defaults applied)
 */
export function computeScheduledAt(
  baseDate:   Date,
  dayOffset:  number,
  timeOfDay:  string,
  contactTz:  string,
  settings:   Partial<ScheduleSettings> = {},
): Date {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };

  // Resolve the effective timezone
  let tz: string;
  if (cfg.timezoneMode === "contact") {
    tz = isValidIANA(contactTz) ? contactTz : "UTC";
  } else if (cfg.timezoneMode === "fixed") {
    tz = isValidIANA(cfg.fixedTz) ? cfg.fixedTz : "UTC";
  } else {
    tz = "UTC";
  }

  // Add dayOffset days to baseDate
  const candidate = new Date(baseDate.getTime() + dayOffset * 86_400_000);

  // Set the time-of-day component in the target timezone
  const [sendH, sendM] = parseTime(timeOfDay);
  const localDate = toLocalDate(candidate, tz);
  localDate.setHours(sendH, sendM, 0, 0);

  // Convert back to UTC
  let scheduled = fromLocalDate(localDate, tz);

  // Advance into the next valid business window if needed
  scheduled = advanceToSendWindow(scheduled, cfg, tz);

  return scheduled;
}

/**
 * Advance `dt` to the next valid send window slot.
 * Iterates at most 10 days to avoid infinite loops with bad configs.
 */
function advanceToSendWindow(dt: Date, cfg: ScheduleSettings, tz: string): Date {
  const [startH, startM] = parseTime(cfg.sendStart);
  const [endH,   endM]   = parseTime(cfg.sendEnd);

  for (let attempt = 0; attempt < 10; attempt++) {
    const local = toLocalDate(dt, tz);
    const isoDay = local.getDay() === 0 ? 7 : local.getDay(); // Sun = 0 → 7
    const inDays = cfg.sendDays.includes(isoDay);

    const afterStart = local.getHours() > startH
      || (local.getHours() === startH && local.getMinutes() >= startM);
    const beforeEnd  = local.getHours() < endH
      || (local.getHours() === endH && local.getMinutes() <= endM);

    if (inDays && afterStart && beforeEnd) return dt;

    // Either wrong day or outside hours — jump to next valid slot
    if (!inDays || !afterStart) {
      // Advance to the next allowed day at send start
      let next = toLocalDate(dt, tz);
      next.setHours(startH, startM, 0, 0);
      if (!afterStart && inDays) {
        // today is valid but we're before start → same day at start
        dt = fromLocalDate(next, tz);
        continue;
      }
      // Move to next day
      next = toLocalDate(new Date(dt.getTime() + 86_400_000), tz);
      next.setHours(startH, startM, 0, 0);
      dt = fromLocalDate(next, tz);
      continue;
    }

    if (!beforeEnd) {
      // Past end of day — move to next day at send start
      const next = toLocalDate(new Date(dt.getTime() + 86_400_000), tz);
      next.setHours(startH, startM, 0, 0);
      dt = fromLocalDate(next, tz);
    }
  }
  return dt;
}

/** Returns a Date object representing the local clock in `tz` as if it were UTC. */
function toLocalDate(utc: Date, tz: string): Date {
  const localStr = utc.toLocaleString("en-US", { timeZone: tz });
  return new Date(localStr);
}

/** Inverse of toLocalDate — converts a "local as UTC" Date back to UTC. */
function fromLocalDate(local: Date, tz: string): Date {
  // Find the UTC offset at this wall-clock time
  const refStr = local.toLocaleString("en-US", { timeZone: tz });
  const ref = new Date(refStr);
  const offset = local.getTime() - ref.getTime();
  return new Date(local.getTime() - offset);
}

const KNOWN_TZ_RE = /^[A-Za-z]+\/[A-Za-z_]+|UTC|GMT$/;
function isValidIANA(tz: string): boolean {
  if (!tz || !KNOWN_TZ_RE.test(tz)) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
