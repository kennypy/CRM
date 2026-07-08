"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Users, Plus, Building2, GitMerge, KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { FeatureToggleList } from "@/components/admin/feature-toggle";
import { StatsCards, UsageChart, ChildStatsTable } from "@/components/admin/stats-cards";

interface TenantChild {
  id: string;
  name: string;
  slug: string;
  plan: string;
  userCount: number;
}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  dataRegion: string;
  settings: {
    aiEnabled?: boolean;
    aiMonthlyBudgetEvents?: number;
    confidenceThreshold?: number;
    autoApproveThreshold?: number;
    features?: Record<string, boolean>;
  };
  parentTenantId?: string | null;
  parentName?: string | null;
  parentSlug?: string | null;
  userCount: number;
  seatsUsed?: number;
  seatLimit?: number;
  seatLimitOverride?: number | null;
  planSeatDefault?: number | null;
  children: TenantChild[];
  createdAt: string;
}

interface TenantUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  lastLoginAt?: string;
}

interface UsageStats {
  period: string;
  apiCalls: number;
  aiEvents: number;
  aiTokens: number;
  emailsSent: number;
  callsMade: number;
  storageBytes: number;
}

interface StatsData {
  current: UsageStats;
  history: UsageStats[];
  childStats?: Array<{ tenantId: string; tenantName: string; stats: UsageStats }>;
}

interface AllTenant {
  id: string;
  name: string;
  slug: string;
}

export default function WorkspaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingFeature, setSavingFeature] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPlan, setEditPlan] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  // Seat management
  const [seatInput, setSeatInput] = useState("");
  const [savingSeats, setSavingSeats] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);

  // Merge dialog state
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [allTenants, setAllTenants] = useState<AllTenant[]>([]);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    const loadTenant = api.get(`/api/admin/tenants/${id}`).then(async (res) => {
      if (res.ok) {
        const t = (await res.json()).data;
        setTenant(t);
        setEditName(t.name);
        setEditPlan(t.plan);
        setSeatInput(t.seatLimit != null ? String(t.seatLimit) : "");
      }
    }).catch(() => {});

    const loadUsers = api.get(`/api/admin/tenants/${id}/users`).then(async (res) => {
      if (res.ok) setUsers((await res.json()).data ?? []);
    }).catch(() => {});

    const loadStats = api.get(`/api/admin/tenants/${id}/stats`).then(async (res) => {
      if (res.ok) setStats((await res.json()).data ?? null);
    }).catch(() => {});

    Promise.all([loadTenant, loadUsers, loadStats]).finally(() => setLoading(false));
  }, [id]);

  const saveBasicInfo = async () => {
    setSaving(true);
    setMessage(null);
    const res = await api.patch(`/api/admin/tenants/${id}`, { name: editName, plan: editPlan });
    if (res.ok) {
      const updated = (await res.json()).data;
      setTenant(updated);
      setMessage("Saved");
      setTimeout(() => setMessage(null), 2000);
    }
    setSaving(false);
  };

  const saveSeats = async (value: number | null) => {
    setSavingSeats(true);
    setSeatError(null);
    const res = await api.patch(`/api/admin/tenants/${id}/seats`, { seatLimit: value });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setTenant(json.data);
      setSeatInput(json.data.seatLimit != null ? String(json.data.seatLimit) : "");
      setMessage("Seats updated");
      setTimeout(() => setMessage(null), 2000);
    } else {
      setSeatError(json?.error?.message ?? "Could not update seats");
    }
    setSavingSeats(false);
  };

  const toggleFeature = async (key: string, enabled: boolean) => {
    if (!tenant) return;
    setSavingFeature(key);
    const currentFeatures = tenant.settings?.features ?? {};
    const res = await api.patch(`/api/admin/tenants/${id}/features`, {
      features: { ...currentFeatures, [key]: enabled },
    });
    if (res.ok) {
      const updated = (await res.json()).data;
      setTenant(updated);
    }
    setSavingFeature(null);
  };

  const openMergeDialog = async () => {
    const res = await api.get("/api/admin/tenants");
    if (res.ok) {
      const json = await res.json();
      setAllTenants((json.data ?? []).filter((t: AllTenant) => t.id !== id));
    }
    setShowMergeDialog(true);
  };

  const startMerge = async () => {
    if (!mergeSourceId) return;
    setMerging(true);
    const res = await api.post("/api/admin/merges", {
      sourceId: mergeSourceId,
      targetId: id,
    });
    if (res.ok) {
      const json = await res.json();
      router.push(`/admin/merges/${json.data.id}`);
    }
    setMerging(false);
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl text-sm text-muted-foreground">Loading...</div>;
  }

  if (!tenant) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-muted-foreground">Workspace not found.</p>
        <Link href="/admin/workspaces" className="text-sm text-primary hover:underline mt-2 inline-block">
          Back to workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/workspaces"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">
            {tenant.slug} &middot; {tenant.dataRegion.toUpperCase()}
            {tenant.parentName && (
              <span>
                {" "}&middot; Sub-workspace of{" "}
                <Link href={`/admin/workspaces/${tenant.parentTenantId}`} className="text-primary hover:underline">
                  {tenant.parentName}
                </Link>
              </span>
            )}
          </p>
        </div>
        <button
          onClick={openMergeDialog}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <GitMerge className="h-4 w-4" />
          Merge Into
        </button>
      </div>

      {/* Usage Stats */}
      {stats && (
        <div className="space-y-4">
          <h2 className="font-semibold">Usage & Stats</h2>
          <StatsCards stats={stats.current} />
          <UsageChart history={stats.history} />
          {stats.childStats && <ChildStatsTable children={stats.childStats} />}
        </div>
      )}

      {/* License & Seats */}
      {(() => {
        const used = tenant.seatsUsed ?? tenant.userCount ?? 0;
        const limit = tenant.seatLimit ?? 0;
        const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
        const atCap = limit > 0 && used >= limit;
        const isOverride = tenant.seatLimitOverride != null;
        return (
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">License &amp; Seats</h2>
              <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize">{tenant.plan}</span>
            </div>

            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Seats in use</span>
                <span className={atCap ? "font-semibold text-red-600" : "font-semibold"}>
                  {used} / {limit}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${atCap ? "bg-red-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {isOverride
                  ? `Custom seat limit. Plan default is ${tenant.planSeatDefault ?? "—"}.`
                  : `Using the ${tenant.plan} plan default (${tenant.planSeatDefault ?? limit} seats).`}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Seat limit</label>
                <input
                  type="number"
                  min={used}
                  value={seatInput}
                  onChange={(e) => setSeatInput(e.target.value)}
                  className="mt-1 w-32 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. 25"
                />
              </div>
              <button
                onClick={() => saveSeats(seatInput ? Number(seatInput) : null)}
                disabled={savingSeats}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {savingSeats ? "Saving…" : "Set seats"}
              </button>
              <button
                onClick={() => saveSeats((limit || used) + 5)}
                disabled={savingSeats}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add 5 seats
              </button>
              {isOverride && (
                <button
                  onClick={() => saveSeats(null)}
                  disabled={savingSeats}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Reset to plan default
                </button>
              )}
            </div>
            {seatError && <p className="text-sm text-red-600">{seatError}</p>}
          </div>
        );
      })()}

      {/* Basic Info */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Workspace Settings</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Plan</label>
            <select
              value={editPlan}
              onChange={(e) => setEditPlan(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveBasicInfo}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Changes"}
          </button>
          {message && <span className="text-sm text-green-600">{message}</span>}
        </div>
      </div>

      {/* Sub-Workspaces */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Sub-Workspaces ({tenant.children.length})</h2>
          </div>
          <Link
            href={`/admin/workspaces/${id}/sub-workspaces/new`}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Sub-Workspace
          </Link>
        </div>
        <div className="rounded-xl border bg-card divide-y">
          {tenant.children.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No sub-workspaces yet.</p>
          ) : (
            tenant.children.map((c) => (
              <Link
                key={c.id}
                href={`/admin/workspaces/${c.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.slug}</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{c.userCount} users</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{c.plan}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Features */}
      <div className="space-y-3">
        <h2 className="font-semibold">Features</h2>
        <FeatureToggleList
          features={tenant.settings?.features ?? {}}
          onToggle={toggleFeature}
          saving={savingFeature}
        />
      </div>

      {/* Users */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Users ({users.length})</h2>
        </div>
        <div className="rounded-xl border bg-card divide-y">
          {users.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No users in this workspace.</p>
          ) : (
            users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{u.firstName} {u.lastName}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize">
                  {u.role.replace("_", " ")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Merge Dialog */}
      {showMergeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 space-y-4 shadow-lg">
            <h2 className="text-lg font-bold">Merge Workspace Into {tenant.name}</h2>
            <p className="text-sm text-muted-foreground">
              Select a source workspace to merge into this workspace. The source workspace data
              will be moved here, and conflicts will be shown for resolution.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source Workspace</label>
              <select
                value={mergeSourceId}
                onChange={(e) => setMergeSourceId(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select workspace...</option>
                {allTenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={startMerge}
                disabled={!mergeSourceId || merging}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {merging ? "Starting..." : "Preview Merge"}
              </button>
              <button
                onClick={() => setShowMergeDialog(false)}
                className="flex-1 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
