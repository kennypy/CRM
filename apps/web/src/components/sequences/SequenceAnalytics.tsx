"use client";

import { useEffect, useState } from "react";
import { BarChart3, RefreshCw, Mail, Phone, Linkedin, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AnalyticsData {
  enrollments: {
    active:    number;
    completed: number;
    replied:   number;
    optedOut:  number;
    bounced:   number;
  };
  rates: {
    openRate:  number;
    clickRate: number;
    replyRate: number;
  };
  steps: {
    step_number: number;
    type:        string;
    sent:        number;
    opens:       number;
    clicks:      number;
    replies:     number;
    bounces:     number;
  }[];
}

interface SequenceAnalyticsProps {
  sequenceId: string;
}

function MetricCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold", color ?? "text-foreground")}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function RateBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex-1 rounded-full bg-muted h-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-medium text-foreground">{value}%</span>
    </div>
  );
}

const STEP_TYPE_ICONS = {
  email:         Mail,
  call:          Phone,
  linkedin_task: Linkedin,
};

export function SequenceAnalytics({ sequenceId }: SequenceAnalyticsProps) {
  const [data,    setData]    = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  async function fetchAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const res  = await api.get(`/api/v1/outreach/sequences/${sequenceId}/analytics`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to load analytics");
      setData(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAnalytics(); }, [sequenceId]);

  if (loading) return (
    <div className="flex h-48 items-center justify-center">
      <RefreshCw className="h-5 w-5 animate-spin text-primary" />
    </div>
  );

  if (error) return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
  );

  if (!data) return null;

  const totalEnrollments = data.enrollments.active + data.enrollments.completed + data.enrollments.replied + data.enrollments.optedOut + data.enrollments.bounced;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Analytics</h3>
        </div>
        <button onClick={fetchAnalytics} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Enrollment stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Total enrolled" value={totalEnrollments} />
        <MetricCard label="Active"    value={data.enrollments.active}    color="text-green-600" />
        <MetricCard label="Completed" value={data.enrollments.completed} color="text-blue-600" />
        <MetricCard label="Replied"   value={data.enrollments.replied}   color="text-purple-600"
          sub={totalEnrollments > 0 ? `${(data.enrollments.replied / totalEnrollments * 100).toFixed(1)}% of total` : undefined} />
      </div>

      {/* Email rates */}
      {(data.rates.openRate > 0 || data.rates.replyRate > 0) && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Email Performance</span>
          </div>
          <RateBar label="Open rate"  value={data.rates.openRate} />
          <RateBar label="Click rate" value={data.rates.clickRate} />
          <RateBar label="Reply rate" value={data.rates.replyRate} />
        </div>
      )}

      {/* Per-step breakdown */}
      {data.steps.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Step breakdown</h4>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {["Step", "Type", "Sent", "Opens", "Clicks", "Replies", "Bounces"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.steps.map((step) => {
                  const Icon = STEP_TYPE_ICONS[step.type as keyof typeof STEP_TYPE_ICONS] ?? Mail;
                  const openRate  = step.sent > 0 ? (step.opens   / step.sent * 100).toFixed(0) : "—";
                  const clickRate = step.sent > 0 ? (step.clicks  / step.sent * 100).toFixed(0) : "—";
                  const replyRate = step.sent > 0 ? (step.replies / step.sent * 100).toFixed(0) : "—";
                  return (
                    <tr key={step.step_number} className="hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-medium">{step.step_number}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3 w-3 text-muted-foreground" />
                          <span className="capitalize">{step.type.replace("_", " ")}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{step.sent ?? 0}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{openRate}{typeof openRate === "string" && openRate !== "—" ? "%" : ""}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{clickRate}{typeof clickRate === "string" && clickRate !== "—" ? "%" : ""}</td>
                      <td className="px-3 py-2.5 tabular-nums text-green-600 font-medium">{replyRate}{typeof replyRate === "string" && replyRate !== "—" ? "%" : ""}</td>
                      <td className="px-3 py-2.5 tabular-nums text-red-600">{step.bounces ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Opt-outs */}
      {data.enrollments.optedOut > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
          <span className="text-xs text-muted-foreground">Opt-outs / Unsubscribes</span>
          <span className="text-sm font-medium text-muted-foreground">{data.enrollments.optedOut}</span>
        </div>
      )}
    </div>
  );
}
