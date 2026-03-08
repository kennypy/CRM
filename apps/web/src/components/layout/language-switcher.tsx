"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { locales, type Locale } from "@/i18n/config";

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
};

function setLocaleCookie(locale: Locale) {
  document.cookie = `nexcrm_locale=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  try {
    localStorage.setItem("nexcrm_locale", locale);
  } catch {}
}

function getCurrentLocale(): Locale {
  try {
    const stored = localStorage.getItem("nexcrm_locale");
    if (stored && (locales as readonly string[]).includes(stored)) return stored as Locale;
  } catch {}
  const match = document.cookie.match(/nexcrm_locale=([^;]+)/);
  if (match && (locales as readonly string[]).includes(match[1])) return match[1] as Locale;
  return "en";
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Locale>("en");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent(getCurrentLocale());
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const switchLocale = (locale: Locale) => {
    setLocaleCookie(locale);
    setCurrent(locale);
    setOpen(false);
    router.refresh();
  };

  if (compact) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Globe className="h-4 w-4" />
          <span className="text-xs">{current === "pt-BR" ? "PT" : "EN"}</span>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border bg-card py-1 shadow-lg">
            {locales.map((locale) => (
              <button
                key={locale}
                onClick={() => switchLocale(locale)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted",
                  current === locale ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {LOCALE_LABELS[locale]}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {locales.map((locale) => (
          <button
            key={locale}
            onClick={() => switchLocale(locale)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-colors",
              current === locale
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            <Globe className="h-5 w-5" />
            {LOCALE_LABELS[locale]}
          </button>
        ))}
      </div>
    </div>
  );
}
