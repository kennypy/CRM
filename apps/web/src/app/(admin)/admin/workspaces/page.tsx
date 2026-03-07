"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, Building2, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  dataRegion: string;
  parentTenantId: string | null;
  userCount: number;
  childCount: number;
  createdAt: string;
}

export default function WorkspacesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("all");
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

  // Build hierarchical structure: parents first, children indented
  const orderedTenants = useMemo(() => {
    const filtered = tenants.filter((t) => {
      if (planFilter !== "all" && t.plan !== planFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
      }
      return true;
    });

    if (search) return filtered; // flat list when searching

    const parents = filtered.filter(t => !t.parentTenantId);
    const childMap = new Map<string, Tenant[]>();
    for (const t of filtered) {
      if (t.parentTenantId) {
        const list = childMap.get(t.parentTenantId) ?? [];
        list.push(t);
        childMap.set(t.parentTenantId, list);
      }
    }

    const result: Array<Tenant & { depth: number }> = [];
    for (const p of parents) {
      result.push({ ...p, depth: 0 });
      const children = childMap.get(p.id) ?? [];
      for (const c of children) {
        result.push({ ...c, depth: 1 });
      }
    }

    // Add orphan children (parent filtered out)
    for (const t of filtered) {
      if (t.parentTenantId && !result.find(r => r.id === t.id)) {
        result.push({ ...t, depth: 1 });
      }
    }

    return result;
  }, [tenants, search, planFilter]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tenants.length} workspace{tenants.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/admin/workspaces/new"
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          New Workspace
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search workspaces..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="all">All plans</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : orderedTenants.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            {search || planFilter !== "all" ? "No workspaces match your filters" : "No workspaces yet"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {orderedTenants.map((t) => {
            const depth = "depth" in t ? (t as any).depth : 0;
            return (
              <Link
                key={t.id}
                href={`/admin/workspaces/${t.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
                style={{ paddingLeft: depth > 0 ? `${20 + depth * 28}px` : undefined }}
              >
                <div className="flex items-center gap-3">
                  {depth > 0 && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                  )}
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.slug} &middot; {t.dataRegion.toUpperCase()}
                      {t.childCount > 0 && (
                        <span className="ml-1.5 text-primary">
                          &middot; {t.childCount} sub-workspace{t.childCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">{t.userCount} users</span>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize">
                    {t.plan}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
