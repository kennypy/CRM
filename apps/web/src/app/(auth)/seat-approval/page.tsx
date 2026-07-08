"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Zap, AlertCircle, CheckCircle2, KeyRound } from "lucide-react";

interface SeatRequest {
  seats: number;
  unit_price_cents: number;
  currency: string;
  status: string;
  finance_email: string | null;
  note: string | null;
  requested_by_name: string | null;
  tenant_name: string;
}

function SeatApproval() {
  const token = useSearchParams().get("token") ?? "";
  const [req, setReq] = useState<SeatRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"approved" | "declined" | null>(null);

  useEffect(() => {
    if (!token) { setError("This approval link is missing its token."); setLoading(false); return; }
    fetch("/api/auth/seat-approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "lookup" }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok) setReq(j.data);
        else setError(j?.error?.message ?? "This approval link is invalid or has been used.");
      })
      .catch(() => setError("Unable to load this request."))
      .finally(() => setLoading(false));
  }, [token]);

  const resolve = async (action: "approve" | "decline") => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/auth/seat-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setResult(action === "approve" ? "approved" : "declined");
      else setError(j?.error?.message ?? "Could not record your decision.");
    } catch { setError("Network error — please try again."); }
    finally { setBusy(false); }
  };

  const fmt = (cents: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">NexCRM</h1>
          <p className="text-sm text-muted-foreground">Seat purchase approval</p>
        </div>

        {loading ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : error ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        ) : result ? (
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-3 text-sm ${result === "approved" ? "border-green-200 bg-green-50 text-green-700" : "border-muted bg-muted/40 text-muted-foreground"}`}>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {result === "approved"
              ? `Approved. ${req?.seats} seat(s) have been added to ${req?.tenant_name}.`
              : "You declined this seat request. No changes were made."}
          </div>
        ) : req ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <KeyRound className="h-4 w-4" />
              <span>{req.requested_by_name ?? "A workspace admin"} at <strong>{req.tenant_name}</strong> is requesting more seats.</span>
            </div>
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Additional seats</span><span className="font-medium">{req.seats}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cost per seat</span><span>{fmt(req.unit_price_cents, req.currency)}/mo</span></div>
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Added monthly cost</span><span>{fmt(req.unit_price_cents * req.seats, req.currency)}/mo</span></div>
              {req.note && <p className="border-t pt-2 text-xs text-muted-foreground">Note: {req.note}</p>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => resolve("decline")} disabled={busy}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
                Decline
              </button>
              <button onClick={() => resolve("approve")} disabled={busy}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                {busy ? "Saving…" : "Approve"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function SeatApprovalPage() {
  return (
    <Suspense fallback={<div className="h-64 w-full max-w-md animate-pulse rounded-2xl bg-muted" />}>
      <SeatApproval />
    </Suspense>
  );
}
