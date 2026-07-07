"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Per-user UI font. Mirrors the theme provider: the choice is stored in
 * localStorage and applied by setting the `--font-sans` CSS variable on <html>
 * (which Tailwind's `font-sans` and the body both consume).
 *
 * All five options are system font stacks — no web-font loading — so they render
 * instantly and work offline / on self-hosted deploys with no network at build.
 */

export type FontKey = "system" | "grotesk" | "serif" | "mono" | "rounded";

export const FONTS: Record<FontKey, { label: string; stack: string }> = {
  system:  { label: "System",  stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  grotesk: { label: "Grotesk", stack: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif' },
  rounded: { label: "Rounded", stack: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif' },
  serif:   { label: "Serif",   stack: 'Georgia, Cambria, "Times New Roman", Times, serif' },
  mono:    { label: "Mono",    stack: '"SF Mono", "Cascadia Code", "Consolas", ui-monospace, monospace' },
};

export const DEFAULT_FONT: FontKey = "system";
export const FONT_STORAGE_KEY = "nexcrm_font";

interface FontContextValue {
  font: FontKey;
  setFont: (f: FontKey) => void;
}

const FontContext = createContext<FontContextValue>({ font: DEFAULT_FONT, setFont: () => {} });

function applyFont(font: FontKey) {
  const stack = FONTS[font]?.stack ?? FONTS[DEFAULT_FONT].stack;
  document.documentElement.style.setProperty("--font-sans", stack);
}

export function FontProvider({ children }: { children: React.ReactNode }) {
  const [font, setFontState] = useState<FontKey>(DEFAULT_FONT);

  useEffect(() => {
    const stored = (localStorage.getItem(FONT_STORAGE_KEY) as FontKey) ?? DEFAULT_FONT;
    const valid = stored in FONTS ? stored : DEFAULT_FONT;
    setFontState(valid);
    applyFont(valid);
  }, []);

  const setFont = (f: FontKey) => {
    setFontState(f);
    applyFont(f);
    try { localStorage.setItem(FONT_STORAGE_KEY, f); } catch { /* ignore */ }
  };

  return <FontContext.Provider value={{ font, setFont }}>{children}</FontContext.Provider>;
}

export const useFont = () => useContext(FontContext);
