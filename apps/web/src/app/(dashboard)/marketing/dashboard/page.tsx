"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useTenant } from "@/lib/tenant-context";
import Link from "next/link";
import {
  BarChart3, TrendingUp, Mail, MousePointerClick, UserPlus,
  Target, Users, DollarSign, RefreshCw, Eye, Megaphone,
  ArrowRight,
} from "lucide-react";

interface DashboardData {
  summary: {
    total_campaigns: number;
    active_campaigns: number;
    total_sent: number;
    total_opened: number;
    total_clicked: number;
    total_converted: number;
    total_leads: number;
    total_mqls: number;
    total_sqls: number;
    total_revenue: number;
    total_budget: number;
    total_spend: number;
  };
  byChannel: { channel: string; count: number; revenue: number }[];
  topCampaigns: {
    id: string; name: string; type: string; status: string;
    revenue: number; opened: number; clicked: number; converted: number;
  }[];
}

export default function MarketingDashboardPage() {
  const t = useTranslations("marketing");
  const { tenant } = useTenant();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat(tenant?.locale ?? "en-US", {
      style: "currency", currency: tenant?.defaultCurrency ?? "USD",
    }).format(n ?? 0);

  const fmt = (n: number) => new Intl.NumberFormat(tenant?.locale ?? "en-US").format(n ?? 0);
  const pct = (a: number, b: number) => b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "0%";

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/v1/campaigns/dashboard");
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const s = data?.summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Marketing Dashboard</h1>
            <p className="text-sm text-muted-foreground">Campaign performance at a glance</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchDashboard} className="rounded-lg border p-2 hover:bg-muted">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <Link href="/marketing"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Megaphone className="h-4 w-4" /> View Campaigns <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {loading || !s ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <>
          {/* Top-level KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Campaigns", value: fmt(s.total_campaigns), icon: Megaphone, color: "text-blue-600" },
              { label: "Active Campaigns", value: fmt(s.active_campaigns), icon: TrendingUp, color: "text-green-600" },
              { label: "Total Budget", value: fmtCurrency(s.total_budget), icon: DollarSign, color: "text-amber-600" },
              { label: "Total Revenue", value: fmtCurrency(s.total_revenue), icon: DollarSign, color: "text-emerald-600" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl border bg-card p-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className={cn("h-4 w-4", color)} /> {label}
                </div>
                <p className="mt-2 text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          {/* Funnel metrics */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Sent", value: fmt(s.total_sent), icon: Mail, sub: "" },
              { label: "Opened", value: fmt(s.total_opened), icon: Eye, sub: pct(s.total_opened, s.total_sent) },
              { label: "Clicked", value: fmt(s.total_clicked), icon: MousePointerClick, sub: pct(s.total_clicked, s.total_sent) },
              { label: "Converted", value: fmt(s.total_converted), icon: UserPlus, sub: pct(s.total_converted, s.total_sent) },
            ].map(({ label, value, icon: Icon, sub }) => (
              <div key={label} className="rounded-xl border bg-card p-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className="h-4 w-4" /> {label}
                </div>
                <p className="mt-2 text-2xl font-bold">{value}</p>
                {sub && <p className="text-xs text-muted-foreground">{sub} rate</p>}
              </div>
            ))}
          </div>

          {/* Lead pipeline metrics */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Leads Generated", value: fmt(s.total_leads), icon: TrendingUp },
              { label: "MQLs", value: fmt(s.total_mqls), icon: Target },
              { label: "SQLs", value: fmt(s.total_sqls), icon: Users },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border bg-card p-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className="h-4 w-4" /> {label}
                </div>
                <p className="mt-2 text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Channel breakdown */}
            <div className="rounded-xl border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold">Revenue by Channel</h2>
              {data?.byChannel.length === 0 ? (
                <p className="text-sm text-muted-foreground">No channel data yet</p>
              ) : (
                <div className="space-y-3">
                  {data?.byChannel.map((ch) => {
                    const maxRevenue = Math.max(...(data.byChannel.map((c) => Number(c.revenue)) ?? [1]));
                    const pctWidth = maxRevenue > 0 ? (Number(ch.revenue) / maxRevenue) * 100 : 0;
                    return (
                      <div key={ch.channel} className="flex items-center gap-3">
                        <span className="w-24 text-sm capitalize text-muted-foreground">{ch.channel.replace(/_/g, " ")}</span>
                        <div className="flex-1">
                          <div className="h-6 w-full rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${pctWidth}%` }} />
                          </div>
                        </div>
                        <span className="w-24 text-right text-sm font-medium">{fmtCurrency(Number(ch.revenue))}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top campaigns */}
            <div className="rounded-xl border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold">Top Campaigns by Revenue</h2>
              {data?.topCampaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No campaigns yet</p>
              ) : (
                <div className="space-y-2">
                  {data?.topCampaigns.slice(0, 8).map((camp, idx) => (
                    <div key={camp.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{camp.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{camp.type} &middot; {camp.status}</p>
                      </div>
                      <span className="text-sm font-semibold text-green-600">{fmtCurrency(Number(camp.revenue))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
