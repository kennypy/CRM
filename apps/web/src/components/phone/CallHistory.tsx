"use client";

import { useEffect, useState, useCallback } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, RefreshCw, AlertCircle, Play } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";

interface Call {
  id:              string;
  direction:       "inbound" | "outbound";
  to_number:       string;
  from_number:     string;
  contact_name:    string | null;
  provider:        string;
  status:          string;
  disposition:     string | null;
  duration_seconds: number | null;
  has_recording:   boolean;
  notes:           string | null;
  started_at:      string;
}

interface CallHistoryProps {
  contactId?: string;
}

export function CallHistory({ contactId }: CallHistoryProps) {
  const [calls,   setCalls]   = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (contactId) params.set("contactId", contactId);
      const res  = await api.get(`/api/v1/outreach/calls?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to load calls");
      setCalls(json.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  async function playRecording(callId: string) {
    setPlayingId(callId);
    try {
      const res  = await api.get(`/api/v1/outreach/calls/${callId}/recording`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Recording unavailable");
      window.open(json.data.url, "_blank");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPlayingId(null);
    }
  }

  function formatDuration(s: number | null): string {
    if (s == null) return "—";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  function DirectionIcon({ direction, status }: { direction: string; status: string }) {
    if (status === "no-answer" || status === "busy" || status === "canceled") {
      return <PhoneMissed className="h-3.5 w-3.5 text-red-500" />;
    }
    return direction === "outbound"
      ? <PhoneOutgoing className="h-3.5 w-3.5 text-primary" />
      : <PhoneIncoming className="h-3.5 w-3.5 text-green-600" />;
  }

  const dispositionColors: Record<string, string> = {
    connected:   "bg-green-100 text-green-700",
    voicemail:   "bg-blue-100 text-blue-700",
    "no-answer": "bg-yellow-100 text-yellow-700",
    busy:        "bg-orange-100 text-orange-700",
    "bad-number":"bg-red-100 text-red-700",
    "do-not-call":"bg-red-100 text-red-700",
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {!loading && `${calls.length} call${calls.length !== 1 ? "s" : ""}`}
        </span>
        <button onClick={fetchCalls} disabled={loading} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse border-b border-border px-4 py-3">
              <div className="mb-1.5 flex gap-2">
                <div className="h-3.5 w-3.5 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </div>
              <div className="h-3 w-2/3 rounded bg-muted/60" />
            </div>
          ))
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Phone className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No calls yet</p>
          </div>
        ) : (
          calls.map((call) => (
            <div key={call.id} className="flex items-start gap-3 border-b border-border px-4 py-3">
              <div className="mt-0.5 shrink-0">
                <DirectionIcon direction={call.direction} status={call.status} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {call.contact_name ?? (call.direction === "outbound" ? call.to_number : call.from_number)}
                  </span>
                  {call.disposition && (
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", dispositionColors[call.disposition] ?? "bg-muted text-muted-foreground")}>
                      {call.disposition.replace("-", " ")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{call.direction === "outbound" ? call.to_number : call.from_number}</span>
                  <span>·</span>
                  <span>{formatDuration(call.duration_seconds)}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(call.started_at)}</span>
                </div>
                {call.notes && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{call.notes}</p>
                )}
              </div>
              {call.has_recording && (
                <button
                  onClick={() => playRecording(call.id)}
                  disabled={playingId === call.id}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-40"
                  title="Play recording"
                >
                  {playingId === call.id
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Play className="h-3.5 w-3.5" />
                  }
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
