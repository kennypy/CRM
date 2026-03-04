import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a monetary value.
 *
 * @param value    - Raw number (e.g. 95000)
 * @param currency - ISO 4217 code.  Callers should pass `tenant.defaultCurrency`;
 *                   the default "USD" is only a last-resort fallback so existing
 *                   call-sites don't break before they are migrated.
 * @param compact  - Use compact notation (e.g. "€95K" instead of "€95,000").
 * @param locale   - BCP-47 locale for symbol placement and number grouping
 *                   (e.g. "de-DE" places the € after the number: 95.000 €).
 *                   Defaults to "en-US" when not provided.
 */
export function formatCurrency(
  value: number,
  currency = "USD",
  compact = false,
  locale = "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style:                "currency",
    currency,
    notation:             compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

/**
 * Format a date as a human-readable relative string ("3h ago", "2d ago").
 * Falls back to a localised absolute date for dates older than 7 days.
 *
 * @param date   - Date to format.
 * @param locale - BCP-47 locale for the absolute-date fallback (e.g. "de-DE").
 */
export function formatRelativeTime(
  date: Date | string | null | undefined,
  locale = "en-US",
): string {
  if (date == null) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Never";
  const now = new Date();
  const diffMs    = now.getTime() - d.getTime();
  const diffMins  = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays  = Math.floor(diffMs / 86_400_000);

  if (diffMins  < 1)  return "just now";
  if (diffMins  < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays  < 7)  return `${diffDays}d ago`;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
