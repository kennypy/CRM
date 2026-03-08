"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Building2, Users, ArrowRight, Activity, Brain, Mail, Phone } from "lucide-react";
import { api } from "@/lib/api";

interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  userCount: number;
  childCount: number;
  parentTenantId: string | null;
  createdAt: string;
}

interface PlatformStats {
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

export default function AdminDashboardPage() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTenants = api.get("/api/admin/tenants").then(async (res) => {
      if (res.ok) setTenants((await res.json()).data ?? []);
    }).catch(() => {});

    const loadStats = api.get("/api/admin/stats/platform").then(async (res) => {
      if (res.ok) setPlatformStats((await res.json()).data ?? null);
    }).catch(() => {});

    Promise.all([loadTenants, loadStats]).finally(() => setLoading(false));
  }, []);

  const totalUsers = tenants.reduce((sum, t) => sum + t.userCount, 0);
  const topLevel = tenants.filter(t => !t.parentTenantId);
  const subWorkspaces = tenants.filter(t => t.parentTenantId);
  const planCounts = tenants.reduce(
    (acc, t) => { acc[t.plan] = (acc[t.plan] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage all workspaces and platform-wide settings
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Workspaces</p>
                  <p className="mt-1 text-2xl font-bold">{topLevel.length}</p>
                  {subWorkspaces.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">+ {subWorkspaces.length} sub</p>
                  )}
                </div>
                <div className="rounded-lg bg-blue-100 p-2.5 text-blue-600">
                  <Building2 className="h-5 w-5" />
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Users</p>
                  <p className="mt-1 text-2xl font-bold">{totalUsers}</p>
                </div>
                <div className="rounded-lg bg-green-100 p-2.5 text-green-600">
                  <Users className="h-5 w-5" />
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5">
              <div>
                <p className="text-sm text-muted-foreground">Plans</p>
                <div className="mt-2 space-y-1">
                  {Object.entries(planCounts).map(([plan, count]) => (
                    <div key={plan} className="flex justify-between text-sm">
                      <span className="capitalize">{plan}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {platformStats && (
              <div className="rounded-xl border bg-card p-5">
                <p className="text-sm text-muted-foreground">This Month</p>
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-blue-500" /> API Calls
                    </span>
                    <span className="font-medium">{formatNumber(platformStats.apiCalls)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5">
                      <Brain className="h-3.5 w-3.5 text-purple-500" /> AI Events
                    </span>
                    <span className="font-medium">{formatNumber(platformStats.aiEvents)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-green-500" /> Emails
                    </span>
                    <span className="font-medium">{formatNumber(platformStats.emailsSent)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-orange-500" /> Calls
                    </span>
                    <span className="font-medium">{formatNumber(platformStats.callsMade)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-semibold">Recent Workspaces</h2>
              <Link
                href="/admin/workspaces"
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="divide-y">
              {tenants.slice(0, 5).map((t) => (
                <Link
                  key={t.id}
                  href={`/admin/workspaces/${t.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.slug}
                      {t.childCount > 0 && (
                        <span className="ml-1.5 text-primary">
                          &middot; {t.childCount} sub-workspace{t.childCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{t.userCount} users</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                      {t.plan}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
