"use client";

import { useState } from "react";
import { Phone, Globe, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface IframeConfig {
  id:       string;
  name:     string;
  provider: string;
  embedUrl: string;
  active:   boolean;
}

interface DialerConfigProps {
  config: {
    nativeEnabled:  boolean;
    nativeConfigured: boolean;
    iframeConfigs:  IframeConfig[];
    activeDialer:   "native" | "iframe";
    activeIframeId: string | null;
  };
  onChanged: () => void;
}

export function DialerSelector({ config, onChanged }: DialerConfigProps) {
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);

  if (!config.nativeEnabled && config.iframeConfigs.length <= 1) return null;

  const activeLabel = config.activeDialer === "native"
    ? "Twilio"
    : config.iframeConfigs.find((c) => c.id === config.activeIframeId)?.name ?? "Iframe Dialer";

  async function select(type: "native" | "iframe", iframeId?: string) {
    setSaving(true);
    try {
      await api.patch("/api/v1/outreach/dialers/active", {
        activeDialer:   type,
        activeIframeId: iframeId ?? undefined,
      });
      onChanged();
    } catch { /* ignore */ }
    finally { setSaving(false); setOpen(false); }
  }

  return (
    <div className="relative border-b border-border px-4 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs hover:bg-muted"
        disabled={saving}
      >
        <div className="flex items-center gap-1.5">
          {config.activeDialer === "native" ? <Phone className="h-3 w-3 text-primary" /> : <Globe className="h-3 w-3 text-primary" />}
          <span className="font-medium">{activeLabel}</span>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-4 right-4 top-full z-10 mt-1 rounded-lg border border-border bg-background shadow-lg">
          {config.nativeEnabled && config.nativeConfigured && (
            <button
              onClick={() => select("native")}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-muted",
                config.activeDialer === "native" && "bg-primary/5 font-medium text-primary",
              )}
            >
              <Phone className="h-3.5 w-3.5" /> Twilio (Native)
              {config.activeDialer === "native" && <span className="ml-auto text-[10px] text-primary">Active</span>}
            </button>
          )}
          {config.iframeConfigs.map((ic) => (
            <button
              key={ic.id}
              onClick={() => select("iframe", ic.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-muted",
                config.activeDialer === "iframe" && config.activeIframeId === ic.id && "bg-primary/5 font-medium text-primary",
              )}
            >
              <Globe className="h-3.5 w-3.5" /> {ic.name}
              <span className="text-[10px] text-muted-foreground capitalize">({ic.provider})</span>
              {config.activeDialer === "iframe" && config.activeIframeId === ic.id && (
                <span className="ml-auto text-[10px] text-primary">Active</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
