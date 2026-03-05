"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPlus, RefreshCw, AlertCircle, X, CheckCircle, Users } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Enrollment {
  id:                 string;
  contact_email:      string;
  contact_first_name: string;
  contact_last_name:  string;
  status:             string;
  current_step:       number;
  enrolled_at:        string;
  finished_at:        string | null;
}

interface EnrollmentManagerProps {
  sequenceId: string;
  totalSteps: number;
}

const STATUS_COLORS: Record<string, string> = {
  active:    "bg-green-100 text-green-700",
  paused:    "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
  replied:   "bg-purple-100 text-purple-700",
  opted_out: "bg-gray-100 text-gray-600",
  bounced:   "bg-red-100 text-red-700",
  error:     "bg-red-100 text-red-700",
};

export function EnrollmentManager({ sequenceId, totalSteps }: EnrollmentManagerProps) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [showManual,  setShowManual]  = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [manualFirst, setManualFirst] = useState("");
  const [manualLast,  setManualLast]  = useState("");
  const [enrolling,   setEnrolling]   = useState(false);
  const [enrollResult, setEnrollResult] = useState<{ enrolled: number; skipped: number; reasons: string[] } | null>(null);

  const fetchEnrollments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await api.get(`/api/v1/outreach/sequences/${sequenceId}/enrollments`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to load enrollments");
      setEnrollments(json.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sequenceId]);

  useEffect(() => { fetchEnrollments(); }, [fetchEnrollments]);

  async function handleManualEnroll() {
    if (!manualEmail.trim() || !manualEmail.includes("@")) { setError("Valid email required"); return; }
    setEnrolling(true);
    setError(null);
    setEnrollResult(null);
    try {
      const res  = await api.post(`/api/v1/outreach/sequences/${sequenceId}/enroll`, {
        contacts: [{
          email:     manualEmail.trim().toLowerCase(),
          firstName: manualFirst.trim(),
          lastName:  manualLast.trim(),
          timezone:  Intl.DateTimeFormat().resolvedOptions().timeZone,
        }],
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Enrollment failed");
      setEnrollResult(json.data);
      setManualEmail("");
      setManualFirst("");
      setManualLast("");
      fetchEnrollments();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnrolling(false);
    }
  }

  async function togglePause(enrollment: Enrollment) {
    const action = enrollment.status === "paused" ? "resume" : "pause";
    await api.post(`/api/v1/outreach/sequences/${sequenceId}/enrollments/${enrollment.id}/${action}`, {})
      .then(() => fetchEnrollments())
      .catch(() => {});
  }

  return (
    <div className="space-y-4">
      {/* Enroll header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{enrollments.filter((e) => e.status === "active").length} active</span>
          <span className="text-xs text-muted-foreground">/ {enrollments.length} total enrollments</span>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchEnrollments} disabled={loading} className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button
            onClick={() => setShowManual((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <UserPlus className="h-3 w-3" /> Enroll Contact
          </button>
        </div>
      </div>

      {/* Manual enroll form */}
      {showManual && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Enroll a contact</span>
            <button onClick={() => setShowManual(false)}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" placeholder="First name" value={manualFirst} onChange={(e) => setManualFirst(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <input type="text" placeholder="Last name" value={manualLast} onChange={(e) => setManualLast(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <input type="email" placeholder="Email address *" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <button onClick={handleManualEnroll} disabled={enrolling}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {enrolling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
            {enrolling ? "Enrolling…" : "Enroll"}
          </button>
        </div>
      )}

      {enrollResult && (
        <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs",
          enrollResult.skipped > 0 ? "border-yellow-200 bg-yellow-50 text-yellow-700" : "border-green-200 bg-green-50 text-green-700")}>
          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-medium">{enrollResult.enrolled} enrolled{enrollResult.skipped > 0 ? `, ${enrollResult.skipped} skipped` : ""}</span>
            {enrollResult.reasons.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {enrollResult.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
          <button onClick={() => setEnrollResult(null)} className="ml-auto"><X className="h-3 w-3" /></button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* Enrollment table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              {["Contact", "Status", "Step", "Enrolled", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-3 py-2.5"><div className="h-3 w-3/4 rounded bg-muted" /></td>
                  ))}
                </tr>
              ))
            ) : enrollments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No enrollments yet</td>
              </tr>
            ) : (
              enrollments.map((e) => (
                <tr key={e.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground">
                      {e.contact_first_name} {e.contact_last_name}
                    </div>
                    <div className="text-muted-foreground">{e.contact_email}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn("rounded-full px-2 py-0.5", STATUS_COLORS[e.status] ?? "bg-muted text-muted-foreground")}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {e.current_step} / {totalSteps}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {new Date(e.enrolled_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5">
                    {(e.status === "active" || e.status === "paused") && (
                      <button
                        onClick={() => togglePause(e)}
                        className="text-muted-foreground hover:text-foreground underline"
                      >
                        {e.status === "paused" ? "Resume" : "Pause"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
