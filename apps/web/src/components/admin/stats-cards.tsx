"use client";

import { Activity, Brain, Mail, Phone, HardDrive, BarChart3 } from "lucide-react";

interface UsageStats {
  period: string;
  apiCalls: number;
  aiEvents: number;
  aiTokens: number;
  emailsSent: number;
  callsMade: number;
  storageBytes: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function StatsCards({ stats }: { stats: UsageStats }) {
  const cards = [
    { label: "API Calls", value: formatNumber(stats.apiCalls), icon: Activity, color: "bg-blue-100 text-blue-600" },
    { label: "AI Events", value: formatNumber(stats.aiEvents), icon: Brain, color: "bg-purple-100 text-purple-600" },
    { label: "Emails Sent", value: formatNumber(stats.emailsSent), icon: Mail, color: "bg-green-100 text-green-600" },
    { label: "Calls Made", value: formatNumber(stats.callsMade), icon: Phone, color: "bg-orange-100 text-orange-600" },
    { label: "Storage", value: formatBytes(stats.storageBytes), icon: HardDrive, color: "bg-gray-100 text-gray-600" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-bold">{value}</p>
            </div>
            <div className={`rounded-lg p-2 ${color}`}>
              <Icon className="h-4 w-4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function UsageChart({ history }: { history: UsageStats[] }) {
  if (history.length === 0) return null;

  const maxCalls = Math.max(...history.map(h => h.apiCalls), 1);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">API Calls (Last 6 Months)</h3>
      </div>
      <div className="flex items-end gap-2 h-32">
        {history.slice().reverse().map((h) => {
          const height = Math.max((h.apiCalls / maxCalls) * 100, 2);
          return (
            <div key={h.period} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{formatNumber(h.apiCalls)}</span>
              <div
                className="w-full rounded-t bg-primary/80 transition-all"
                style={{ height: `${height}%` }}
              />
              <span className="text-[10px] text-muted-foreground">{h.period.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChildStatsTable({ children }: { children: Array<{ tenantId: string; tenantName: string; stats: UsageStats }> }) {
  if (children.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card">
      <div className="px-5 py-3 border-b">
        <h3 className="text-sm font-semibold">Sub-Workspace Usage (Current Month)</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-5 py-2 font-medium">Workspace</th>
              <th className="px-3 py-2 font-medium text-right">API Calls</th>
              <th className="px-3 py-2 font-medium text-right">AI Events</th>
              <th className="px-3 py-2 font-medium text-right">Emails</th>
              <th className="px-3 py-2 font-medium text-right">Calls</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {children.map((c) => (
              <tr key={c.tenantId}>
                <td className="px-5 py-2 font-medium">{c.tenantName}</td>
                <td className="px-3 py-2 text-right">{formatNumber(c.stats.apiCalls)}</td>
                <td className="px-3 py-2 text-right">{formatNumber(c.stats.aiEvents)}</td>
                <td className="px-3 py-2 text-right">{formatNumber(c.stats.emailsSent)}</td>
                <td className="px-3 py-2 text-right">{formatNumber(c.stats.callsMade)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
