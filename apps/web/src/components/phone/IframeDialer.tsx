"use client";

/**
 * IframeDialer — configurable iframe embed for 3rd-party dialers.
 *
 * Supports Nooks, Orum, and custom embed URLs.
 * Sends contact context to the dialer via PostMessage (CTI standard).
 *
 * PostMessage payload sent on mount:
 *   { type: "nexcrm:context", contact: { phone, name, email } }
 *
 * Listens for incoming PostMessage events from the dialer:
 *   { type: "dialer:call_started",  data: { to, callId } }
 *   { type: "dialer:call_ended",    data: { to, duration, disposition } }
 *   { type: "dialer:call_logged",   data: { ... } }
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";

interface IframeDialerProps {
  name:          string;
  embedUrl:      string;
  provider:      string;
  contactPhone?: string;
  contactName?:  string;
  contactEmail?: string;
}

export function IframeDialer({
  name, embedUrl, provider, contactPhone, contactName, contactEmail,
}: IframeDialerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Inject contact context once iframe loads
  function onIframeLoad() {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;

    // Validate embed URL origin before posting
    try {
      const origin = new URL(embedUrl).origin;
      frame.contentWindow.postMessage(
        {
          type: "nexcrm:context",
          contact: {
            phone: contactPhone ?? "",
            name:  contactName  ?? "",
            email: contactEmail ?? "",
          },
        },
        origin,
      );
    } catch {
      // Non-fatal — some dialers don't accept postMessage
    }
  }

  // Listen for call events from the dialer
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Only accept messages from the expected dialer origin
      let expectedOrigin: string;
      try { expectedOrigin = new URL(embedUrl).origin; }
      catch { return; }
      if (event.origin !== expectedOrigin) return;

      const msg = event.data as { type?: string; data?: Record<string, unknown> };
      if (!msg?.type) return;

      if (msg.type === "dialer:call_ended" || msg.type === "dialer:call_logged") {
        const d = msg.data ?? {};
        // Log the call in our system
        api.post("/api/v1/outreach/calls", {
          contactEmail,
          contactName,
          direction:       "outbound",
          toNumber:        (d.to as string) ?? contactPhone ?? "unknown",
          fromNumber:      "dialer",
          provider,
          status:          "completed",
          durationSeconds: typeof d.duration === "number" ? d.duration : undefined,
          disposition:     typeof d.disposition === "string" ? d.disposition : undefined,
          recordingConsentConfirmed: false,
        }).catch(() => {});
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [embedUrl, provider, contactEmail, contactName, contactPhone]);

  // Basic URL validation
  let validUrl = false;
  try { new URL(embedUrl); validUrl = true; }
  catch { /* invalid */ }

  if (!validUrl) {
    return (
      <div className="flex flex-1 items-start gap-2 p-4 text-xs text-red-600">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Invalid embed URL configured. Ask an admin to update it in Settings → Dialer.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{name}</span>
        <a
          href={embedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          title="Open in new tab"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 text-xs text-red-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={embedUrl}
        onLoad={onIframeLoad}
        onError={() => setError("Failed to load dialer. Check the embed URL in Settings.")}
        className="flex-1 w-full border-0"
        allow="microphone; camera; autoplay"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        title={`${name} dialer`}
      />
    </div>
  );
}
