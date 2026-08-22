"use client";

/**
 * Settings → Navigation: tab groups + per-user extra tabs.
 *
 * Tab groups tame nav overload: a "Sales" group can show only Contacts /
 * Companies / Opportunities, a "Marketing" group Campaigns / Leads. Groups are
 * assigned to base roles and/or user profiles; a default group catches
 * everyone else; and individual users can be granted extra tabs.
 */

import { useEffect, useState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { invalidateNavTabs } from "@/lib/use-nav-tabs";

interface CatalogTab { key: string; labelKey: string }
interface NavGroup {
  id: string;
  name: string;
  description: string | null;
  tabs: string[];
  roles: string[];
  profileIds: string[];
  isDefault: boolean;
  sortOrder: number;
}
interface ProfileOpt { id: string; name: string }
interface UserOpt { id: string; firstName: string; lastName: string; email: string }

const ROLE_OPTIONS = [
  { value: "admin",     label: "Admin" },
  { value: "manager",   label: "Manager" },
  { value: "rep",       label: "Rep" },
  { value: "read_only", label: "Read only" },
];

/** Human label from the catalog key: "/lead-scoring" → "Lead scoring". */
function tabLabel(key: string): string {
  if (key === "/") return "Home";
  const base = key.slice(1).replace(/-/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1.5 block text-sm font-medium";

export function NavigationTab() {
  const [catalog,  setCatalog]  = useState<CatalogTab[]>([]);
  const [groups,   setGroups]   = useState<NavGroup[]>([]);
  const [profiles, setProfiles] = useState<ProfileOpt[]>([]);
  const [users,    setUsers]    = useState<UserOpt[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [editing,  setEditing]  = useState<Partial<NavGroup> | null>(null);
  const [saving,   setSaving]   = useState(false);

  // Per-user extras
  const [extraUserId, setExtraUserId] = useState<string>("");
  const [extraTabs,   setExtraTabs]   = useState<string[]>([]);
  const [extrasDirty, setExtrasDirty] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [cj, gj, pj, uj] = await Promise.all([
        api.get("/api/v1/nav/catalog").then((r) => r.json()).catch(() => null),
        api.get("/api/v1/nav/groups").then((r) => r.json()).catch(() => null),
        api.get("/api/v1/user-profiles").then((r) => r.json()).catch(() => null),
        api.get("/api/v1/users").then((r) => r.json()).catch(() => null),
      ]);
      if (cj?.success) setCatalog(cj.data);
      if (gj?.success) setGroups(gj.data);
      if (pj?.success) setProfiles(pj.data);
      if (uj?.success) setUsers(uj.data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!extraUserId) { setExtraTabs([]); return; }
    api.get(`/api/v1/nav/users/${extraUserId}`)
      .then((r) => r.json())
      .then((j) => { if (j?.success) { setExtraTabs(j.data.extraTabs ?? []); setExtrasDirty(false); } })
      .catch(() => setExtraTabs([]));
  }, [extraUserId]);

  const toggleListValue = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const save = async () => {
    if (!editing?.name?.trim()) { setError("Name is required"); return; }
    if (!editing.tabs?.length)  { setError("Pick at least one tab"); return; }
    setSaving(true); setError(null);
    const body = {
      name: editing.name,
      description: editing.description ?? null,
      tabs: editing.tabs ?? [],
      roles: editing.roles ?? [],
      profileIds: editing.profileIds ?? [],
      isDefault: editing.isDefault ?? false,
      sortOrder: editing.sortOrder ?? 0,
    };
    try {
      const res = editing.id
        ? await api.patch(`/api/v1/nav/groups/${editing.id}`, body)
        : await api.post("/api/v1/nav/groups", body);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error?.message ?? "Failed to save tab group"); return; }
      setEditing(null);
      invalidateNavTabs();
      await load();
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: NavGroup) => {
    if (!window.confirm(`Delete the "${g.name}" tab group? Users fall back to the default navigation.`)) return;
    const res = await api.delete(`/api/v1/nav/groups/${g.id}`).catch(() => null);
    if (res?.ok) { invalidateNavTabs(); await load(); }
  };

  const saveExtras = async () => {
    if (!extraUserId) return;
    const res = await api.put(`/api/v1/nav/users/${extraUserId}`, { extraTabs }).catch(() => null);
    if (res?.ok) { setExtrasDirty(false); invalidateNavTabs(); }
    else setError("Failed to save user tabs");
  };

  if (loading) return <p className="py-8 text-sm text-muted-foreground">Loading navigation settings…</p>;

  return (
    <div className="max-w-3xl space-y-8">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {/* ── Tab groups ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Tab groups</h2>
          <p className="text-sm text-muted-foreground">
            Show each team only the tabs it needs. Groups match by user profile first, then base role;
            mark one group as default for everyone else. No groups = everyone sees the full navigation.
          </p>
        </div>

        {editing ? (
          <div className="space-y-4 rounded-xl border p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Name *</label>
                <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className={inputCls} placeholder="e.g. Sales" />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  className={inputCls} placeholder="Who this is for" />
              </div>
            </div>

            <div>
              <label className={labelCls}>Tabs (shown in this order)</label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border p-2 sm:grid-cols-3">
                {catalog.map((t) => {
                  const checked = (editing.tabs ?? []).includes(t.key);
                  return (
                    <label key={t.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                      <input type="checkbox" checked={checked}
                        onChange={() => setEditing({ ...editing, tabs: toggleListValue(editing.tabs ?? [], t.key) })} />
                      {tabLabel(t.key)}
                    </label>
                  );
                })}
              </div>
              {(editing.tabs?.length ?? 0) > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Order: {(editing.tabs ?? []).map(tabLabel).join(" → ")} (first 6 inline, the rest under “More”)
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Applies to roles</label>
                <div className="space-y-1 rounded-lg border p-2">
                  {ROLE_OPTIONS.map((r) => (
                    <label key={r.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                      <input type="checkbox" checked={(editing.roles ?? []).includes(r.value)}
                        onChange={() => setEditing({ ...editing, roles: toggleListValue(editing.roles ?? [], r.value) })} />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Applies to profiles</label>
                <div className="max-h-40 space-y-1 overflow-auto rounded-lg border p-2">
                  {profiles.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No profiles defined</p>}
                  {profiles.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                      <input type="checkbox" checked={(editing.profileIds ?? []).includes(p.id)}
                        onChange={() => setEditing({ ...editing, profileIds: toggleListValue(editing.profileIds ?? [], p.id) })} />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.isDefault ?? false}
                onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} />
              Default group (applies to everyone without a matching group)
            </label>

            <div className="flex gap-3">
              <button type="button" onClick={() => { setEditing(null); setError(null); }}
                className="flex-1 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">Cancel</button>
              <button type="button" onClick={save} disabled={saving}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                {saving ? "Saving…" : "Save group"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{g.name}</p>
                      {g.isDefault && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Default</span>
                      )}
                      {g.roles.map((r) => (
                        <span key={r} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{r}</span>
                      ))}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{g.tabs.map(tabLabel).join(" · ")}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => setEditing({ ...g, tabs: [...g.tabs], roles: [...g.roles], profileIds: [...g.profileIds] })}
                      className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">Edit</button>
                    <button onClick={() => remove(g)} className="rounded-md p-1 text-muted-foreground hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {groups.length === 0 && (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No tab groups yet — everyone sees the full navigation.
                </p>
              )}
            </div>
            <button onClick={() => setEditing({ name: "", description: "", tabs: [], roles: [], profileIds: [], isDefault: false })}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-2.5 text-sm font-medium hover:bg-muted">
              <Plus className="h-4 w-4" /> New tab group
            </button>
          </>
        )}
      </section>

      {/* ── Per-user extra tabs ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Per-user tabs</h2>
          <p className="text-sm text-muted-foreground">
            Grant an individual user tabs on top of their group — e.g. give one marketer the Reports tab.
          </p>
        </div>
        <select value={extraUserId} onChange={(e) => setExtraUserId(e.target.value)} className={cn(inputCls, "max-w-sm")}>
          <option value="">Select a user…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.firstName} {u.lastName} — {u.email}</option>
          ))}
        </select>
        {extraUserId && (
          <>
            <div className="grid grid-cols-2 gap-1 rounded-lg border p-2 sm:grid-cols-3">
              {catalog.map((t) => (
                <label key={t.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                  <input type="checkbox" checked={extraTabs.includes(t.key)}
                    onChange={() => { setExtraTabs((prev) => toggleListValue(prev, t.key)); setExtrasDirty(true); }} />
                  {tabLabel(t.key)}
                </label>
              ))}
            </div>
            <button onClick={saveExtras} disabled={!extrasDirty}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
              Save user tabs
            </button>
          </>
        )}
      </section>
    </div>
  );
}
