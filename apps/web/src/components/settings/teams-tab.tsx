"use client";

/**
 * Settings → Teams. Create teams, manage membership, and (via the permissions
 * model) share records with a whole team at once. Admin-gated by the parent tab.
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import {
  Users, Plus, Trash2, X, UserPlus, Crown, Search, AlertCircle, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Team {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isLead: boolean;
}

interface OrgUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

function initials(f?: string, l?: string) {
  return `${f?.[0] ?? ""}${l?.[0] ?? ""}`.toUpperCase() || "?";
}

function CreateTeamModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Team) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post("/api/v1/teams", { name, description: description || null });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? "Couldn't create the team."); return; }
      onCreated(data.data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-primary" /> New team</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. EMEA Sales"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading || !name}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {loading ? "Creating…" : "Create team"}
          </button>
        </form>
      </div>
    </div>
  );
}

function AddMemberModal({ teamId, existing, allUsers, onClose, onAdded }: {
  teamId: string; existing: Set<string>; allUsers: OrgUser[]; onClose: () => void; onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const candidates = allUsers.filter(
    (u) => !existing.has(u.id) &&
      `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(query.toLowerCase()),
  );

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    if (!selected.size) return;
    setLoading(true);
    try {
      await api.post(`/api/v1/teams/${teamId}/members`, { userIds: [...selected] });
      onAdded();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><UserPlus className="h-4 w-4 text-primary" /> Add members</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people…"
            className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">No one else to add.</p>
          ) : candidates.map((u) => (
            <button key={u.id} onClick={() => toggle(u.id)}
              className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted",
                selected.has(u.id) && "bg-primary/10")}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                {initials(u.firstName, u.lastName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{u.firstName} {u.lastName}</span>
                <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
              </span>
              <span className={cn("h-4 w-4 shrink-0 rounded border", selected.has(u.id) ? "border-primary bg-primary" : "border-border")} />
            </button>
          ))}
        </div>
        <button onClick={save} disabled={!selected.size || loading}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {loading ? "Adding…" : `Add ${selected.size || ""} ${selected.size === 1 ? "member" : "members"}`.trim()}
        </button>
      </div>
    </div>
  );
}

export function TeamsTab() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [allUsers, setAllUsers] = useState<OrgUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRes, uRes] = await Promise.all([api.get("/api/v1/teams"), api.get("/api/v1/users")]);
      const tData = await tRes.json().catch(() => ({}));
      const uData = await uRes.json().catch(() => ({}));
      if (!tRes.ok) { setError(tData?.error?.message ?? "Couldn't load teams."); return; }
      setTeams(tData.data ?? []);
      setAllUsers(uData.data ?? []);
    } catch {
      setError("Network error — could not load teams.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async (id: string) => {
    const res = await api.get(`/api/v1/teams/${id}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setMembers(data.data?.members ?? []);
  }, []);

  useEffect(() => { loadTeams(); }, [loadTeams]);
  useEffect(() => { if (selectedId) loadMembers(selectedId); }, [selectedId, loadMembers]);

  const selected = teams.find((t) => t.id === selectedId) ?? null;

  const removeMember = async (userId: string) => {
    if (!selectedId) return;
    setMembers((m) => m.filter((x) => x.id !== userId));
    await api.delete(`/api/v1/teams/${selectedId}/members/${userId}`);
    loadTeams();
  };

  const deleteTeam = async (id: string) => {
    if (!confirm("Delete this team? Records shared with it will lose that grant.")) return;
    await api.delete(`/api/v1/teams/${id}`);
    if (selectedId === id) setSelectedId(null);
    setTeams((ts) => ts.filter((t) => t.id !== id));
  };

  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">Loading teams…</div>;

  if (error && teams.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={loadTeams} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Teams</h2>
          <p className="text-sm text-muted-foreground">Group people to share records and route work. Teams can be granted access to records in Permissions.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New team
        </button>
      </div>

      {teams.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No teams yet. Create one to start grouping people.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* Team list */}
          <div className="space-y-2">
            {teams.map((t) => (
              <button key={t.id} onClick={() => setSelectedId(t.id)}
                className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50",
                  selectedId === t.id ? "border-primary bg-primary/5" : "border-border")}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.memberCount} {t.memberCount === 1 ? "member" : "members"}{t.description ? ` · ${t.description}` : ""}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>

          {/* Detail */}
          <div className="rounded-xl border border-border p-4">
            {!selected ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Users className="h-7 w-7" /> Select a team to manage its members.
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{selected.name}</h3>
                    {selected.description && <p className="text-sm text-muted-foreground">{selected.description}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowAdd(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                      <UserPlus className="h-3.5 w-3.5" /> Add
                    </button>
                    <button onClick={() => deleteTeam(selected.id)}
                      className="rounded-lg border border-border p-1.5 text-red-600 hover:bg-red-50" title="Delete team">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {members.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No members yet. Add people to this team.</p>
                ) : (
                  <div className="space-y-1">
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                          {initials(m.firstName, m.lastName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm">
                            <span className="truncate">{m.firstName} {m.lastName}</span>
                            {m.isLead && <Crown className="h-3 w-3 text-amber-500" />}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{m.email} · {m.role}</span>
                        </span>
                        <button onClick={() => removeMember(m.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600" title="Remove">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateTeamModal onClose={() => setShowCreate(false)}
          onCreated={(t) => { setTeams((ts) => [...ts, t].sort((a, b) => a.name.localeCompare(b.name))); setSelectedId(t.id); setShowCreate(false); }} />
      )}
      {showAdd && selected && (
        <AddMemberModal teamId={selected.id} existing={new Set(members.map((m) => m.id))} allUsers={allUsers}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); loadMembers(selected.id); loadTeams(); }} />
      )}
    </div>
  );
}
