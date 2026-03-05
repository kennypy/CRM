"use client";

import { useState, useEffect } from "react";
import { X, Phone } from "lucide-react";
import { api } from "@/lib/api";
import { DialerSelector } from "./DialerSelector";
import { NativeDialer }   from "./NativeDialer";
import { IframeDialer }   from "./IframeDialer";
import { CallHistory }    from "./CallHistory";
import { cn } from "@/lib/utils";

export interface PhoneDrawerProps {
  contactId?:    string;
  contactEmail?: string;
  contactName?:  string;
  contactPhone?: string;
  onClose:       () => void;
}

interface DialerConfig {
  nativeEnabled:  boolean;
  nativeConfigured: boolean;
  iframeConfigs:  { id: string; name: string; provider: string; embedUrl: string; active: boolean }[];
  activeDialer:   "native" | "iframe";
  activeIframeId: string | null;
}

type PhoneTab = "dial" | "history";

export function PhoneDrawer({
  contactId, contactEmail, contactName, contactPhone, onClose,
}: PhoneDrawerProps) {
  const [tab,    setTab]    = useState<PhoneTab>("dial");
  const [config, setConfig] = useState<DialerConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to build config from localStorage comm settings as fallback
    function buildLocalConfig(): DialerConfig | null {
      try {
        const raw = localStorage.getItem("nexcrm_comms_config");
        if (!raw) return null;
        const cfg = JSON.parse(raw);
        const dialler = cfg?.dialler;
        if (!dialler) return null;
        if (dialler.provider === "twilio" && dialler.twilioSid) {
          return {
            nativeEnabled: true, nativeConfigured: true,
            iframeConfigs: [], activeDialer: "native", activeIframeId: null,
          };
        }
        if ((dialler.provider === "voip" || dialler.provider === "native") && dialler.voipUrl) {
          return {
            nativeEnabled: false, nativeConfigured: false,
            iframeConfigs: [{ id: "local", name: "Dialler", provider: dialler.provider, embedUrl: dialler.voipUrl, active: true }],
            activeDialer: "iframe", activeIframeId: "local",
          };
        }
        if (dialler.provider === "native" && !dialler.voipUrl) {
          return {
            nativeEnabled: true, nativeConfigured: true,
            iframeConfigs: [], activeDialer: "native", activeIframeId: null,
          };
        }
      } catch {}
      return null;
    }

    api.get("/api/v1/outreach/dialers/config")
      .then((r) => r.json())
      .then((j) => {
        const apiConfig = j.data ?? null;
        setConfig(apiConfig ?? buildLocalConfig());
      })
      .catch(() => setConfig(buildLocalConfig()))
      .finally(() => setLoading(false));
  }, []);

  const activeIframe = config?.iframeConfigs.find((c) => c.id === config.activeIframeId) ?? null;
  const showNative   = config?.activeDialer === "native" && config?.nativeEnabled && config?.nativeConfigured;
  const showIframe   = config?.activeDialer === "iframe" && !!activeIframe;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[480px] flex-col border-l border-border bg-background shadow-2xl">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">
            Phone
            {contactName && <span className="ml-1 font-normal text-muted-foreground">— {contactName}</span>}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(["dial", "history"] as PhoneTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2.5 text-xs font-medium capitalize transition-colors",
              tab === t
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "dial" ? "Dialer" : "Call History"}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {tab === "dial" && (
          <div className="flex h-full flex-col">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Dialer selector (shown only when both native and iframe are configured) */}
                {config && (config.nativeEnabled || config.iframeConfigs.length > 0) && (
                  <DialerSelector
                    config={config}
                    onChanged={() => {
                      api.get("/api/v1/outreach/dialers/config")
                        .then((r) => r.json())
                        .then((j) => setConfig(j.data ?? null))
                        .catch(() => {});
                    }}
                  />
                )}

                {showNative && (
                  <NativeDialer
                    contactId={contactId}
                    contactEmail={contactEmail}
                    contactName={contactName}
                    defaultNumber={contactPhone}
                  />
                )}

                {showIframe && activeIframe && (
                  <IframeDialer
                    name={activeIframe.name}
                    embedUrl={activeIframe.embedUrl}
                    provider={activeIframe.provider}
                    contactPhone={contactPhone}
                    contactName={contactName}
                    contactEmail={contactEmail}
                  />
                )}

                {!showNative && !showIframe && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                    <Phone className="h-12 w-12 text-muted-foreground/30" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">No dialer configured</p>
                      <p className="mt-1 text-xs text-muted-foreground/70">
                        Ask an admin to configure a dialer in Settings → Dialer
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "history" && (
          <CallHistory contactId={contactId} />
        )}
      </div>
    </div>
  );
}
