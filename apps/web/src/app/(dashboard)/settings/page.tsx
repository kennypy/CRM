"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";
import { api } from "@/lib/api";
import { useTenant } from "@/lib/tenant-context";
import {
  Settings, Users, Plug, CreditCard, Shield, User,
  Plus, Trash2, Mail, CheckCircle2, AlertCircle,
  Globe, Lock, Key, Monitor, LogOut, Building2, Phone, Sun, Moon,
} from "lucide-react";
import type { StoredUser } from "@/lib/auth";
import { useTheme } from "@/components/theme/theme-provider";
import type { Theme } from "@/components/theme/theme-provider";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TeamUser {
  id: string; firstName: string; lastName: string; email: string;
  role: "admin" | "manager" | "rep" | "read_only";
  lastLoginAt?: string; status: "active" | "invited";
}

const DEMO_USERS: TeamUser[] = [
  { id: "1", firstName: "Sarah",  lastName: "Kim",       email: "sarah@acme.com",  role: "admin",   lastLoginAt: "2h ago",  status: "active"  },
  { id: "2", firstName: "Marcus", lastName: "Chen",      email: "marcus@acme.com", role: "manager", lastLoginAt: "1d ago",  status: "active"  },
  { id: "3", firstName: "Priya",  lastName: "Sharma",    email: "priya@acme.com",  role: "rep",     lastLoginAt: "3h ago",  status: "active"  },
  { id: "4", firstName: "Alex",   lastName: "Johnson",   email: "alex@acme.com",   role: "rep",     lastLoginAt: "5h ago",  status: "active"  },
  { id: "5", firstName: "Jamie",  lastName: "Rodriguez", email: "jamie@acme.com",  role: "rep",     lastLoginAt: undefined, status: "invited" },
];

const INTEGRATIONS = [
  { id: "gmail",   name: "Gmail",           icon: "📧", status: "connected", account: "admin@nexcrm.dev", desc: "Email ingestion active"          },
  { id: "gcal",    name: "Google Calendar", icon: "📅", status: "connected", account: "admin@nexcrm.dev", desc: "Meetings auto-captured"          },
  { id: "outlook", name: "Outlook / MS365", icon: "📬", status: "available", account: null,               desc: "Connect to ingest Outlook mail"  },
  { id: "slack",   name: "Slack",           icon: "💬", status: "available", account: null,               desc: "Deal alerts & notifications"     },
  { id: "zoom",    name: "Zoom",            icon: "🎥", status: "available", account: null,               desc: "Auto-transcribe meetings"         },
  { id: "stripe",  name: "Stripe",          icon: "💳", status: "available", account: null,               desc: "Revenue data sync"               },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", manager: "Manager", rep: "Rep", read_only: "Read Only",
};
const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-700",   admin:     "bg-purple-100 text-purple-700",
  manager:     "bg-blue-100 text-blue-700", rep:       "bg-green-100 text-green-700",
  read_only:   "bg-gray-100 text-gray-600",
};

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY", "CHF", "INR", "BRL"];
const SUPPORTED_TIMEZONES  = [
  "UTC", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Singapore",
  "Asia/Tokyo", "Australia/Sydney",
];

type Tab = "profile" | "general" | "users" | "integrations" | "billing" | "security" | "communications";

// ── Theme Selector ─────────────────────────────────────────────────────────────

function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; label: string; icon: React.FC<{ className?: string }> }[] = [
    { value: "light",  label: "Light",  icon: Sun     },
    { value: "dark",   label: "Dark",   icon: Moon    },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <div>
      <label className="mb-2 block text-sm font-medium">Theme</label>
      <div className="flex gap-2">
        {options.map(({ value, label, icon: Icon }) => (
          <button key={value} onClick={() => setTheme(value)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-colors",
              theme === value
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            )}>
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Profile ───────────────────────────────────────────────────────────────

function ProfileTab({ user }: { user: StoredUser | null }) {
  const initials = user ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` : "?";
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName,  setLastName]  = useState(user?.lastName  ?? "");
  const [email,     setEmail]     = useState(user?.email     ?? "");
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  const saveProfile = async () => {
    if (!firstName.trim() || !email.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await api.patch("/api/v1/users/me", { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "Failed to save profile");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold">
          {initials}
        </div>
        <div>
          <p className="text-lg font-semibold">{user?.firstName} {user?.lastName}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize", ROLE_COLORS[user?.role ?? "rep"])}>
            {ROLE_LABELS[user?.role ?? "rep"]}
          </span>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">Personal Information</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Last name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputCls} />
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={saveProfile} disabled={saving || !firstName.trim() || !email.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" /> Saved!</span>}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-semibold">Appearance</h3>
        <ThemeSelector />
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h3 className="font-semibold">Workspace</h3>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Organisation</span>
          <span className="font-medium">{user?.tenantName}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Role</span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ROLE_COLORS[user?.role ?? "rep"])}>
            {ROLE_LABELS[user?.role ?? "rep"]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          To change your role, contact your workspace admin.
        </p>
      </div>
    </div>
  );
}

// ── Tab: General (Company Settings — admin only) ────────────────────────────────

function GeneralTab({ user }: { user: StoredUser | null }) {
  const { tenant, refresh } = useTenant();
  const [orgName,  setOrgName]  = useState(user?.tenantName ?? "");
  const [timezone, setTimezone] = useState(tenant.timezone);
  const [currency, setCurrency] = useState(tenant.defaultCurrency);
  const [saved,    setSaved]    = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => { setTimezone(tenant.timezone); setCurrency(tenant.defaultCurrency); }, [tenant.timezone, tenant.defaultCurrency]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await api.patch("/api/v1/tenant", { defaultCurrency: currency, timezone });
      if (!res.ok) { const json = await res.json().catch(() => ({})); setError(json?.error?.message ?? "Failed to save"); return; }
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { setError("Network error — please try again"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700">
        <Building2 className="h-4 w-4 shrink-0" />
        <p>These settings apply to your entire workspace. Only admins can change them.</p>
      </div>
      <div>
        <h3 className="text-base font-semibold mb-4">Organisation</h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Organisation name</label>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium flex items-center gap-2"><Globe className="h-4 w-4" />Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {SUPPORTED_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Default currency</label>
            <p className="mb-2 text-xs text-muted-foreground">All new deals default to this currency.</p>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>
      {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" /> Saved!</span>}
      </div>
    </div>
  );
}

// ── Tab: Users ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]               = useState<TeamUser[]>(DEMO_USERS);
  const [inviteEmail, setInviteEmail]   = useState("");
  const [inviteRole,  setInviteRole]    = useState<TeamUser["role"]>("rep");
  const [showInvite,  setShowInvite]    = useState(false);
  const [inviting,    setInviting]      = useState(false);
  const [deletingId,  setDeletingId]    = useState<string | null>(null);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api.post("/api/v1/users/invite", { email: inviteEmail.trim(), role: inviteRole });
    } catch { /* fall through — add optimistically */ }
    setUsers((us) => [...us, { id: Date.now().toString(), firstName: inviteEmail.split("@")[0], lastName: "", email: inviteEmail.trim(), role: inviteRole, status: "invited" }]);
    setInviteEmail(""); setShowInvite(false); setInviting(false);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await api.delete(`/api/v1/users/${id}`);
      if (res.ok || res.status === 404) {
        setUsers((us) => us.filter((x) => x.id !== id));
      }
    } catch {
      setUsers((us) => us.filter((x) => x.id !== id)); // remove optimistically if API unreachable
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{users.length} team members</p>
        <button onClick={() => setShowInvite((v) => !v)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> Invite user
        </button>
      </div>
      {showInvite && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
          <h4 className="text-sm font-medium">Invite a team member</h4>
          <div className="flex gap-2">
            <input type="email" placeholder="colleague@company.com" value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none">
              {(["admin", "manager", "rep", "read_only"] as const).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {inviting ? "Sending…" : "Send invite"}
            </button>
            <button onClick={() => setShowInvite(false)} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>{["User", "Role", "Last active", "Status", ""].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                      {(u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "")}
                    </div>
                    <div>
                      <p className="font-medium">{u.firstName} {u.lastName}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ROLE_COLORS[u.role])}>
                    {ROLE_LABELS[u.role]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{u.lastLoginAt ?? "Never"}</td>
                <td className="px-4 py-3">
                  {u.status === "active"
                    ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Active</span>
                    : <span className="flex items-center gap-1 text-xs text-yellow-600"><Mail className="h-3 w-3" /> Invited</span>}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => handleDelete(u.id)} disabled={deletingId === u.id}
                    className="text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-40">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Integrations ──────────────────────────────────────────────────────────

function IntegrationsTab() {
  const [integrations,   setIntegrations]   = useState(INTEGRATIONS);
  const [disconnecting,  setDisconnecting]  = useState<string | null>(null);

  const disconnect = async (id: string) => {
    setDisconnecting(id);
    try {
      await api.delete(`/api/v1/integrations/${id}`);
    } catch { /* fall through — update locally anyway */ }
    setIntegrations((prev) => prev.map((i) => i.id === id ? { ...i, status: "available", account: null } : i));
    setDisconnecting(null);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {integrations.map((intg) => (
        <div key={intg.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{intg.icon}</span>
              <div>
                <p className="font-medium text-sm">{intg.name}</p>
                <p className="text-xs text-muted-foreground">{intg.desc}</p>
                {intg.status === "connected" && intg.account && (
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{intg.account}</p>
                )}
              </div>
            </div>
            {intg.status === "connected" ? (
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
                <button onClick={() => disconnect(intg.id)} disabled={disconnecting === intg.id}
                  className="text-xs text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50">
                  {disconnecting === intg.id ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            ) : (
              <button className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted shrink-0">Connect</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Billing ───────────────────────────────────────────────────────────────

function BillingTab() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-xl border bg-gradient-to-r from-primary/5 to-accent/5 p-6">
        <div className="flex items-start justify-between">
          <div>
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">GROWTH</span>
            <p className="mt-3 text-2xl font-bold">$49 <span className="text-base font-normal text-muted-foreground">/ user / month</span></p>
            <p className="text-sm text-muted-foreground mt-1">5 users · Billed monthly · Next billing Mar 15</p>
          </div>
          <button className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">Upgrade to Enterprise</button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {[
            { label: "AI extractions", used: "8,432", limit: "Unlimited" },
            { label: "Contacts",       used: "1,247", limit: "Unlimited" },
            { label: "Storage",        used: "2.3 GB", limit: "50 GB"   },
          ].map(({ label, used, limit }) => (
            <div key={label} className="rounded-lg bg-background/60 p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold">{used}</p>
              <p className="text-xs text-muted-foreground">of {limit}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <h3 className="font-semibold mb-3">Payment method</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded bg-muted px-3 py-2 font-mono text-xs">VISA •••• 4242</div>
            <span className="text-xs text-muted-foreground">Expires 12/26</span>
          </div>
          <button className="text-sm text-primary hover:underline">Update</button>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Security ──────────────────────────────────────────────────────────────

function SecurityTab() {
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaved, setPwSaved] = useState(false);
  const [twoFa, setTwoFa]    = useState(false);

  const DEMO_SESSIONS = [
    { id: "s1", device: "Chrome · Windows",   ip: "192.168.1.10", lastActive: "Active now",  current: true  },
    { id: "s2", device: "Safari · macOS",      ip: "81.103.45.21", lastActive: "2 hours ago", current: false },
    { id: "s3", device: "NexCRM Mobile · iOS", ip: "81.103.45.21", lastActive: "1 day ago",   current: false },
  ];
  const DEMO_KEYS = [
    { id: "k1", name: "CI/CD Integration",  created: "2026-01-12", lastUsed: "3 days ago", prefix: "nxc_ci_••••••" },
    { id: "k2", name: "Internal Reporting", created: "2026-02-01", lastUsed: "Today",       prefix: "nxc_rp_••••••" },
  ];
  const [sessions, setSessions] = useState(DEMO_SESSIONS);
  const [apiKeys,  setApiKeys]  = useState(DEMO_KEYS);

  return (
    <div className="space-y-8 max-w-lg">
      <section>
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2"><Lock className="h-4 w-4" /> Change Password</h3>
        <div className="space-y-3">
          {(["current", "next", "confirm"] as const).map((field) => (
            <div key={field}>
              <label className="mb-1.5 block text-sm font-medium">
                {field === "current" ? "Current password" : field === "next" ? "New password" : "Confirm new password"}
              </label>
              <input type="password" value={pwForm[field]} onChange={(e) => setPwForm((f) => ({ ...f, [field]: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button disabled={!pwForm.current || !pwForm.next || pwForm.next !== pwForm.confirm}
              onClick={() => { setPwSaved(true); setPwForm({ current: "", next: "", confirm: "" }); setTimeout(() => setPwSaved(false), 2500); }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              Update password
            </button>
            {pwSaved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" /> Password updated</span>}
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><Shield className="h-4 w-4" /> Two-Factor Authentication</h3>
        <div className="flex items-center justify-between rounded-lg border bg-card p-4">
          <div>
            <p className="text-sm font-medium">Authenticator app (TOTP)</p>
            <p className="text-xs text-muted-foreground mt-0.5">{twoFa ? "2FA is enabled." : "Add an extra layer of protection."}</p>
          </div>
          <button onClick={() => setTwoFa((v) => !v)}
            className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              twoFa ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200" : "bg-primary text-primary-foreground hover:opacity-90")}>
            {twoFa ? "Disable 2FA" : "Enable 2FA"}
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><Monitor className="h-4 w-4" /> Active Sessions</h3>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <div><p className="text-sm font-medium">{s.device}</p><p className="text-xs text-muted-foreground">{s.ip} · {s.lastActive}</p></div>
              {s.current
                ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Current</span>
                : <button onClick={() => setSessions((prev) => prev.filter((x) => x.id !== s.id))}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-600 transition-colors">
                    <LogOut className="h-3 w-3" /> Revoke
                  </button>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold flex items-center gap-2"><Key className="h-4 w-4" /> API Keys</h3>
          <button className="text-xs text-primary hover:underline">+ New key</button>
        </div>
        <div className="space-y-2">
          {apiKeys.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <div>
                <p className="text-sm font-medium">{k.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{k.prefix}</p>
                <p className="text-xs text-muted-foreground">Created {k.created} · Last used {k.lastUsed}</p>
              </div>
              <button onClick={() => setApiKeys((prev) => prev.filter((x) => x.id !== k.id))}
                className="text-muted-foreground hover:text-red-600 transition-colors"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {apiKeys.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No API keys. Create one above.</p>}
        </div>
      </section>
    </div>
  );
}

// ── Tab: Communications ────────────────────────────────────────────────────────

const STORAGE_KEY_COMMS = "nexcrm_comms_config";

function loadCommsConfig() {
  try {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY_COMMS) : null;
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

function CommunicationsTab() {
  const [emailCfg, setEmailCfg] = useState({
    provider: "smtp",
    host: "",
    port: "587",
    username: "",
    password: "",
    fromName: "",
    fromEmail: "",
    tls: true,
  });

  const [diallerCfg, setDiallerCfg] = useState({
    provider: "twilio",
    twilioSid: "",
    twilioToken: "",
    twilioFrom: "",
    voipUrl: "",
  });

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = loadCommsConfig();
    if (cfg?.email) setEmailCfg((prev) => ({ ...prev, ...cfg.email }));
    if (cfg?.dialler) setDiallerCfg((prev) => ({ ...prev, ...cfg.dialler }));
  }, []);

  const setEmail = (k: keyof typeof emailCfg) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEmailCfg((prev) => ({ ...prev, [k]: e.target.value }));

  const setDialler = (k: keyof typeof diallerCfg) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDiallerCfg((prev) => ({ ...prev, [k]: e.target.value }));

  const save = async () => {
    // Persist locally for offline/fast access
    try {
      localStorage.setItem(STORAGE_KEY_COMMS, JSON.stringify({ email: emailCfg, dialler: diallerCfg }));
    } catch {}
    // Also sync to server so settings survive browser data clear
    try {
      await api.patch("/api/v1/tenant", { settings: { comms: { email: emailCfg, dialler: diallerCfg } } });
    } catch { /* non-fatal — local copy is the fallback */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelCls = "mb-1.5 block text-sm font-medium";

  return (
    <div className="space-y-8 max-w-lg">
      {/* Email config */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold">Email Configuration</h3>
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <label className={labelCls}>Provider</label>
            <select value={emailCfg.provider} onChange={setEmail("provider")} className={inputCls}>
              <option value="smtp">SMTP (custom)</option>
              <option value="gmail">Gmail / Google Workspace</option>
              <option value="outlook">Outlook / Microsoft 365</option>
              <option value="sendgrid">SendGrid</option>
            </select>
          </div>
          {emailCfg.provider === "smtp" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>SMTP host</label>
                  <input value={emailCfg.host} onChange={setEmail("host")} placeholder="smtp.example.com" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Port</label>
                  <input value={emailCfg.port} onChange={setEmail("port")} placeholder="587" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Username</label>
                  <input value={emailCfg.username} onChange={setEmail("username")} placeholder="user@example.com" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Password</label>
                  <input type="password" value={emailCfg.password} onChange={setEmail("password")} placeholder="••••••••" className={inputCls} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input id="tls" type="checkbox" checked={emailCfg.tls}
                  onChange={(e) => setEmailCfg((prev) => ({ ...prev, tls: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary" />
                <label htmlFor="tls" className="text-sm">Use TLS / STARTTLS</label>
              </div>
            </>
          )}
          {(emailCfg.provider === "gmail" || emailCfg.provider === "outlook") && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <p>Connect via OAuth in the <strong>Integrations</strong> tab — no credentials needed here.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>From name</label>
              <input value={emailCfg.fromName} onChange={setEmail("fromName")} placeholder="ACME Sales" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>From email</label>
              <input type="email" value={emailCfg.fromEmail} onChange={setEmail("fromEmail")} placeholder="sales@acme.com" className={inputCls} />
            </div>
          </div>
        </div>
      </section>

      {/* Dialler config */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Phone className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold">Dialler Configuration</h3>
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <label className={labelCls}>Dialler provider</label>
            <select value={diallerCfg.provider} onChange={setDialler("provider")} className={inputCls}>
              <option value="twilio">Twilio (built-in)</option>
              <option value="voip">Custom VOIP / SIP URL</option>
              <option value="native">Browser native (tel: links)</option>
            </select>
          </div>

          {diallerCfg.provider === "twilio" && (
            <>
              <div>
                <label className={labelCls}>Account SID</label>
                <input value={diallerCfg.twilioSid} onChange={setDialler("twilioSid")} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Auth token</label>
                <input type="password" value={diallerCfg.twilioToken} onChange={setDialler("twilioToken")} placeholder="••••••••••••••••••••••••••••••••" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>From number</label>
                <input value={diallerCfg.twilioFrom} onChange={setDialler("twilioFrom")} placeholder="+15551234567" className={inputCls} />
                <p className="mt-1 text-xs text-muted-foreground">Must be a Twilio-verified number in E.164 format.</p>
              </div>
            </>
          )}

          {diallerCfg.provider === "voip" && (
            <div>
              <label className={labelCls}>VOIP / embedded dialler URL</label>
              <input value={diallerCfg.voipUrl} onChange={setDialler("voipUrl")} placeholder="https://dialler.yourpbx.com/embed" className={inputCls} />
              <p className="mt-1 text-xs text-muted-foreground">The URL will be loaded in an iframe when you open the phone panel.</p>
            </div>
          )}

          {diallerCfg.provider === "native" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
                Phone numbers will open as <code className="font-mono">tel:</code> links using your system&apos;s default app.
              </div>
              <div>
                <label className={labelCls}>Embedded dialler URL <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input value={diallerCfg.voipUrl} onChange={setDialler("voipUrl")} placeholder="https://your-dialler.com/embed" className={inputCls} />
                <p className="mt-1 text-xs text-muted-foreground">
                  If provided, this URL loads as an iframe inside the phone sidebar panel instead of opening a tel: link.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Save changes
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" /> Saved!
          </span>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }>; adminOnly?: boolean }[] = [
  { id: "profile",      label: "My Profile",   icon: User     },
  { id: "security",     label: "Security",     icon: Shield   },
  { id: "general",      label: "Company",      icon: Building2, adminOnly: true },
  { id: "users",        label: "Users",        icon: Users,     adminOnly: true },
  { id: "integrations",   label: "Integrations",   icon: Plug,      adminOnly: true },
  { id: "communications", label: "Communications", icon: Phone,     adminOnly: true },
  { id: "billing",        label: "Billing",        icon: CreditCard, adminOnly: true },
];

const VALID_TABS = new Set(TABS.map((t) => t.id));

function SettingsInner() {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab") as Tab | null;
  const initialTab: Tab = rawTab && VALID_TABS.has(rawTab) ? rawTab : "profile";

  const [tab,  setTab]  = useState<Tab>(initialTab);
  const [user, setUser] = useState<StoredUser | null>(null);
  useEffect(() => { setUser(getStoredUser()); }, []);

  const isAdmin = ["admin", "super_admin", "manager"].includes(user?.role ?? "");
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="flex h-full gap-6">
      <aside className="w-52 shrink-0">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1">Personal</p>
          <nav className="space-y-0.5">
            {visibleTabs.filter((t) => !t.adminOnly).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                  tab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <Icon className="h-4 w-4 shrink-0" />{label}
              </button>
            ))}
          </nav>
        </div>
        {isAdmin && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1 mt-4">Workspace</p>
            <nav className="space-y-0.5">
              {visibleTabs.filter((t) => t.adminOnly).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                    tab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                  <Icon className="h-4 w-4 shrink-0" />{label}
                </button>
              ))}
            </nav>
          </div>
        )}
      </aside>

      <div className="flex-1 overflow-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">{TABS.find((t) => t.id === tab)?.label}</h1>
        </div>
        {tab === "profile"      && <ProfileTab user={user} />}
        {tab === "security"     && <SecurityTab />}
        {tab === "general"      && <GeneralTab user={user} />}
        {tab === "users"        && <UsersTab />}
        {tab === "integrations"   && <IntegrationsTab />}
        {tab === "communications" && <CommunicationsTab />}
        {tab === "billing"        && <BillingTab />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="h-8 w-48 rounded bg-muted animate-pulse" />}>
      <SettingsInner />
    </Suspense>
  );
}
