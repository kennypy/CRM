"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Building2, Users, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";

interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  userCount: number;
  createdAt: string;
}

export default function AdminDashboardPage() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/admin/tenants").then(async (res) => {
      if (res.ok) {
        const json = await res.json();
        setTenants(json.data ?? []);
      }
      setLoading(false);
    });
  }, []);

  const totalUsers = tenants.reduce((sum, t) => sum + t.userCount, 0);
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Workspaces</p>
                  <p className="mt-1 text-2xl font-bold">{tenants.length}</p>
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
                    <p className="text-xs text-muted-foreground">{t.slug}</p>
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
