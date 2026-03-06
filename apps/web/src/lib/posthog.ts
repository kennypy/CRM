"use client";

import posthog from "posthog-js";

let initialised = false;

export function initPostHog() {
  if (initialised) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return;

  posthog.init(key, {
    api_host:           process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    person_profiles:    "identified_only",
    capture_pageview:   false, // we fire manually in layout
    capture_pageleave:  true,
    autocapture:        false, // opt-in captures only — avoids capturing sensitive form data
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-sensitive]",
    },
  });

  initialised = true;
}

export { posthog };
