"use client";

import { useState, useRef, useEffect } from "react";
import { Columns3, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColDef {
  key: string;
  label: string;
  required?: boolean;
}

export function useColumnPrefs(storageKey: string, defs: ColDef[]) {
  const [visible, setVisible] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(defs.map((d) => d.key));
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const arr: string[] = JSON.parse(stored);
        const required = defs.filter((d) => d.required).map((d) => d.key);
        return new Set([...required, ...arr.filter((k) => defs.some((d) => d.key === k))]);
      }
    } catch {}
    return new Set(defs.map((d) => d.key));
  });

  const toggle = (key: string) => {
    const def = defs.find((d) => d.key === key);
    if (def?.required) return;
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  return { visible, toggle };
}

export function ColumnPicker({ defs, visible, toggle }: {
  defs: ColDef[];
  visible: Set<string>;
  toggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        title="Manage columns"
      >
        <Columns3 className="h-3.5 w-3.5" />
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border bg-card shadow-lg py-1">
          <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Show / hide columns
          </p>
          {defs.map((def) => (
            <button
              key={def.key}
              onClick={() => !def.required && toggle(def.key)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted text-left",
                def.required && "opacity-50 cursor-default"
              )}
            >
              <span className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                visible.has(def.key)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background"
              )}>
                {visible.has(def.key) && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="flex-1">{def.label}</span>
              {def.required && <span className="text-xs text-muted-foreground">fixed</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
