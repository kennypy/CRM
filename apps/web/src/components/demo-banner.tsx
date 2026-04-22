"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, ArrowRight, X } from "lucide-react";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function DemoBanner() {
  const [isDemo, setIsDemo] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIsDemo(getCookie("nexcrm_demo") === "1");
  }, []);

  if (!isDemo || dismissed) return null;

  return (
    <div className="relative flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm text-white">
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        <strong>Demo Mode</strong> — You&apos;re viewing sample data. Actions are
        read-only.
      </span>
      <Link
        href="/start"
        className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-white/30"
      >
        Start Free Trial
        <ArrowRight className="h-3 w-3" />
      </Link>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
        aria-label="Dismiss banner"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Hook to check if we're in demo mode. Returns true if the nexcrm_demo cookie is set.
 * Use this to disable form submissions, edit buttons, etc.
 */
export function useIsDemo(): boolean {
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    setIsDemo(getCookie("nexcrm_demo") === "1");
  }, []);
  return isDemo;
}
