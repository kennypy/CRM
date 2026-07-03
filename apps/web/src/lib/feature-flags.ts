/**
 * Feature flags for pilot / production gating.
 *
 * Some surfaces are still preview-grade: they render simulated or hardcoded
 * data rather than real backend state (embedded dialer, compliance console,
 * coaching, cross-object insights). They must NOT be reachable by a paying
 * pilot customer, where fabricated numbers read as a credibility failure.
 *
 * These routes are hidden from navigation and gated on direct access by
 * default. Set NEXT_PUBLIC_ENABLE_PREVIEW=true to surface them for internal
 * demos / development.
 */

/** Routes whose UI is not yet backed by real data. Hidden unless preview is on. */
export const PREVIEW_ROUTES: readonly string[] = [
  "/calling",
  "/compliance",
  "/coaching",
  "/insights",
  // No /templates route or backend exists yet — the nav link dead-ends on a
  // blank page, so gate it until the feature is built.
  "/templates",
];

export function previewEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_PREVIEW === "true";
}

/** True if a nav/route should be visible & usable in the current build. */
export function isRouteEnabled(href: string): boolean {
  if (previewEnabled()) return true;
  return !PREVIEW_ROUTES.some((p) => href === p || href.startsWith(p + "/"));
}
