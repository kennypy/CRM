"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Users } from "lucide-react";
import { api } from "@/lib/api";
import { FeatureToggleList } from "@/components/admin/feature-toggle";

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
  userCount: number;
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

export default function WorkspaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingFeature, setSavingFeature] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPlan, setEditPlan] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get(`/api/admin/tenants/${id}`),
      api.get(`/api/admin/tenants/${id}/users`),
    ]).then(async ([tenantRes, usersRes]) => {
      if (tenantRes.ok) {
        const t = (await tenantRes.json()).data;
        setTenant(t);
        setEditName(t.name);
        setEditPlan(t.plan);
      }
      if (usersRes.ok) {
        setUsers((await usersRes.json()).data ?? []);
      }
      setLoading(false);
    });
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
        <div>
          <h1 className="text-2xl font-bold">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">{tenant.slug} &middot; {tenant.dataRegion.toUpperCase()}</p>
        </div>
      </div>

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
    </div>
  );
}
