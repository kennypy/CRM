"use client";

/**
 * Cloudflare Turnstile widget. Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * is configured — the auth service enforces the challenge server-side whenever
 * TURNSTILE_SECRET_KEY is set, so the two must be configured together.
 */

import { useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export const turnstileEnabled = Boolean(SITE_KEY);

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
    };
    __nexcrmTurnstileReady?: () => void;
  }
}

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const rendered = useRef(false);

  useEffect(() => {
    if (!SITE_KEY || !ref.current || rendered.current) return;

    const render = () => {
      if (!window.turnstile || !ref.current || rendered.current) return;
      rendered.current = true;
      window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(""),
        "error-callback": () => onTokenRef.current(""),
      });
    };

    if (window.turnstile) {
      render();
      return;
    }
    window.__nexcrmTurnstileReady = render;
    if (!document.querySelector("script[data-nexcrm-turnstile]")) {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__nexcrmTurnstileReady";
      s.async = true;
      s.setAttribute("data-nexcrm-turnstile", "1");
      document.head.appendChild(s);
    }
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="my-1" />;
}
