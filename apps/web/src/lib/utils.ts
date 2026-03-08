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
 * i18n-aware relative time labels. Pass these from useTranslations('common')
 * to get localised strings. When omitted, falls back to English.
 */
export interface RelativeTimeLabels {
  never: string;
  justNow: string;
  minutesAgo: (vars: { count: number }) => string;
  hoursAgo: (vars: { count: number }) => string;
  daysAgo: (vars: { count: number }) => string;
}

const DEFAULT_LABELS: RelativeTimeLabels = {
  never: "Never",
  justNow: "just now",
  minutesAgo: ({ count }) => `${count}m ago`,
  hoursAgo: ({ count }) => `${count}h ago`,
  daysAgo: ({ count }) => `${count}d ago`,
};

/**
 * Format a date as a human-readable relative string ("3h ago", "2d ago").
 * Falls back to a localised absolute date for dates older than 7 days.
 *
 * @param date   - Date to format.
 * @param locale - BCP-47 locale for the absolute-date fallback (e.g. "de-DE").
 * @param labels - i18n labels for relative time strings.
 */
export function formatRelativeTime(
  date: Date | string | null | undefined,
  locale = "en-US",
  labels: RelativeTimeLabels = DEFAULT_LABELS,
): string {
  if (date == null) return labels.never;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return labels.never;
  const now = new Date();
  const diffMs    = now.getTime() - d.getTime();
  const diffMins  = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays  = Math.floor(diffMs / 86_400_000);

  if (diffMins  < 1)  return labels.justNow;
  if (diffMins  < 60) return labels.minutesAgo({ count: diffMins });
  if (diffHours < 24) return labels.hoursAgo({ count: diffHours });
  if (diffDays  < 7)  return labels.daysAgo({ count: diffDays });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
