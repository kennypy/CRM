"use client";

/**
 * Native Twilio WebRTC dialer.
 * Loads the Twilio Device on mount using a server-issued access token.
 * The Twilio JS SDK is loaded dynamically to avoid SSR issues.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, RefreshCw, AlertCircle,
  Hash, Delete, Volume2,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NativeDialerProps {
  contactId?:    string;
  contactEmail?: string;
  contactName?:  string;
  defaultNumber?: string;
}

type CallStatus = "idle" | "connecting" | "ringing" | "in-call" | "ended" | "error";

export function NativeDialer({
  contactId, contactEmail, contactName, defaultNumber,
}: NativeDialerProps) {
  const [number,     setNumber]     = useState(defaultNumber ?? "");
  const [status,     setStatus]     = useState<CallStatus>("idle");
  const [muted,      setMuted]      = useState(false);
  const [elapsed,    setElapsed]    = useState(0);
  const [error,      setError]      = useState<string | null>(null);
  const [consentGiven, setConsent]  = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);

  const deviceRef    = useRef<any>(null);
  const callRef      = useRef<any>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef   = useRef(0);

  // Load Twilio JS SDK and initialise device
  useEffect(() => {
    let Device: any;
    let mounted = true;

    async function init() {
      try {
        // Dynamic import — only load in browser
        const twilio = await import(/* webpackIgnore: true */ "https://sdk.twilio.com/js/client/v2.0/twilio.min.js" as any).catch(() => null);

        const tokenRes  = await api.post("/api/v1/outreach/calls/token", {});
        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenJson.error?.message ?? "Token error");

        if (!mounted) return;

        const DeviceClass = (window as any).Twilio?.Device;
        if (!DeviceClass) throw new Error("Twilio SDK not loaded");

        const device = new DeviceClass(tokenJson.data.token, { logLevel: 1 });
        device.on("ready", () => { if (mounted) setDeviceReady(true); });
        device.on("error", (err: any) => { if (mounted) setError(err.message); });
        device.on("disconnect", () => {
          if (!mounted) return;
          setStatus("ended");
          stopTimer();
          logCall("completed");
        });

        deviceRef.current = device;
      } catch (err: any) {
        if (mounted) setError(err.message);
      }
    }

    init();
    return () => {
      mounted = false;
      deviceRef.current?.destroy();
    };
  }, []);

  function startTimer() {
    elapsedRef.current = 0;
    setElapsed(0);
    timerRef.current = setInterval(() => {
      elapsedRef.current++;
      setElapsed(elapsedRef.current);
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function logCall(callStatus: string) {
    if (!number) return;
    await api.post("/api/v1/outreach/calls", {
      contactId,
      contactEmail,
      contactName,
      direction: "outbound",
      toNumber: number,
      fromNumber: "twilio",
      provider: "twilio",
      status: callStatus,
      durationSeconds: elapsedRef.current,
      recordingConsentConfirmed: consentGiven,
    }).catch(() => {});
  }

  async function handleCall() {
    if (!number.trim()) { setError("Enter a phone number"); return; }
    if (!deviceRef.current) { setError("Dialer not ready — check Twilio config"); return; }
    setError(null);
    setStatus("connecting");
    try {
      const call = await deviceRef.current.connect({
        params: { To: number, ContactId: contactId ?? "" },
      });
      callRef.current = call;
      call.on("accept", () => { setStatus("in-call"); startTimer(); });
      call.on("ringing", () => setStatus("ringing"));
      call.on("disconnect", () => { setStatus("ended"); stopTimer(); logCall("completed"); });
      call.on("error", (err: any) => { setStatus("error"); setError(err.message); stopTimer(); logCall("failed"); });
    } catch (err: any) {
      setStatus("error");
      setError(err.message);
    }
  }

  function handleHangup() {
    callRef.current?.disconnect();
    stopTimer();
    setStatus("ended");
    logCall("completed");
  }

  function toggleMute() {
    if (callRef.current) {
      callRef.current.mute(!muted);
      setMuted(!muted);
    }
  }

  function pressKey(key: string) {
    if (status === "in-call") { callRef.current?.sendDigits(key); return; }
    setNumber((n) => n + key);
  }

  function formatElapsed(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  const isActive = status === "connecting" || status === "ringing" || status === "in-call";

  const KEYPAD = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["*", "0", "#"],
  ];

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-6">
      {/* Status indicator */}
      {!deviceReady && !error && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3 animate-spin" /> Connecting dialer…
        </div>
      )}
      {deviceReady && status === "idle" && (
        <div className="flex items-center gap-1.5 text-xs text-green-600">
          <span className="h-2 w-2 rounded-full bg-green-500" /> Ready
        </div>
      )}
      {status === "ringing" && (
        <div className="flex items-center gap-2 text-xs text-yellow-600">
          <RefreshCw className="h-3 w-3 animate-spin" /> Ringing…
        </div>
      )}
      {status === "in-call" && (
        <div className="flex items-center gap-2 text-sm font-mono font-medium text-green-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          {formatElapsed(elapsed)}
        </div>
      )}
      {(status === "ended") && (
        <div className="text-xs text-muted-foreground">Call ended · {formatElapsed(elapsed)}</div>
      )}

      {error && (
        <div className="flex w-full items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* Number display */}
      <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <span className="flex-1 font-mono text-lg tracking-wider text-foreground">
          {number || <span className="text-muted-foreground/50">Enter number</span>}
        </span>
        {number && (
          <button onClick={() => setNumber((n) => n.slice(0, -1))} className="text-muted-foreground hover:text-foreground">
            <Delete className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-2 w-full max-w-[220px]">
        {KEYPAD.flat().map((k) => (
          <button
            key={k}
            onClick={() => pressKey(k)}
            className="rounded-full border border-border bg-muted/40 py-3 text-sm font-medium hover:bg-muted active:scale-95"
          >
            {k}
          </button>
        ))}
      </div>

      {/* Recording consent */}
      {!isActive && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={consentGiven}
            onChange={(e) => setConsent(e.target.checked)}
            className="rounded"
          />
          I confirm recording consent has been obtained (where required by law)
        </label>
      )}

      {/* Call controls */}
      <div className="flex items-center gap-4">
        {isActive ? (
          <>
            <button
              onClick={toggleMute}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full border-2",
                muted ? "border-yellow-400 bg-yellow-50 text-yellow-600" : "border-border bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <button
              onClick={handleHangup}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 active:scale-95"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
            <button className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-border bg-muted text-muted-foreground">
              <Volume2 className="h-5 w-5" />
            </button>
          </>
        ) : (
          <button
            onClick={status === "ended" ? () => { setStatus("idle"); setElapsed(0); } : handleCall}
            disabled={!deviceReady}
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full text-white active:scale-95",
              status === "ended"
                ? "bg-blue-500 hover:bg-blue-600"
                : "bg-green-500 hover:bg-green-600 disabled:opacity-40",
            )}
          >
            {status === "ended"
              ? <RefreshCw className="h-6 w-6" />
              : <Phone className="h-6 w-6" />
            }
          </button>
        )}
      </div>
    </div>
  );
}
