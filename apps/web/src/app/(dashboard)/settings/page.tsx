"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";
import { api } from "@/lib/api";
import { useTenant } from "@/lib/tenant-context";
import {
  Settings, Users, Plug, CreditCard, Shield,
  Plus, Trash2, Mail, CheckCircle2, AlertCircle,
  Globe, Lock, Key, Monitor, LogOut,
} from "lucide-react";
import type { StoredUser } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TeamUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "admin" | "manager" | "rep" | "read_only";
  lastLoginAt?: string;
  status: "active" | "invited";
}

const DEMO_USERS: TeamUser[] = [
  { id: "1", firstName: "Sarah",   lastName: "Kim",       email: "sarah@acme.com",   role: "admin",   lastLoginAt: "2h ago",  status: "active"  },
  { id: "2", firstName: "Marcus",  lastName: "Chen",      email: "marcus@acme.com",  role: "manager", lastLoginAt: "1d ago",  status: "active"  },
  { id: "3", firstName: "Priya",   lastName: "Sharma",    email: "priya@acme.com",   role: "rep",     lastLoginAt: "3h ago",  status: "active"  },
  { id: "4", firstName: "Alex",    lastName: "Johnson",   email: "alex@acme.com",    role: "rep",     lastLoginAt: "5h ago",  status: "active"  },
  { id: "5", firstName: "Jamie",   lastName: "Rodriguez", email: "jamie@acme.com",   role: "rep",     lastLoginAt: undefined, status: "invited" },
];

const INTEGRATIONS = [
  { id: "gmail",   name: "Gmail",            icon: "📧", status: "connected", account: "admin@nexcrm.dev",         desc: "Email ingestion active" },
  { id: "gcal",    name: "Google Calendar",  icon: "📅", status: "connected", account: "admin@nexcrm.dev",         desc: "Meetings auto-captured" },
  { id: "outlook", name: "Outlook / MS365",  icon: "📬", status: "available", account: null,                       desc: "Connect to ingest Outlook mail" },
  { id: "slack",   name: "Slack",            icon: "💬", status: "available", account: null,                       desc: "Deal alerts & notifications" },
  { id: "zoom",    name: "Zoom",             icon: "🎥", status: "available", account: null,                       desc: "Auto-transcribe meetings" },
  { id: "stripe",  name: "Stripe",           icon: "💳", status: "available", account: null,                       desc: "Revenue data sync" },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", manager: "Manager", rep: "Rep", read_only: "Read Only",
};
const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-700",
  admin:       "bg-purple-100 text-purple-700",
  manager:     "bg-blue-100 text-blue-700",
  rep:         "bg-green-100 text-green-700",
  read_only:   "bg-gray-100 text-gray-600",
};

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "SGD", "JPY", "CHF", "INR", "BRL"];
const SUPPORTED_TIMEZONES  = [
  "UTC", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Singapore",
  "Asia/Tokyo", "Australia/Sydney",
];

type Tab = "general" | "users" | "integrations" | "billing" | "security";

// ── Tab: General ───────────────────────────────────────────────────────────────

function GeneralTab({ user }: { user: StoredUser | null }) {
  const { tenant, refresh } = useTenant();

  const [orgName,  setOrgName]  = useState(user?.tenantName ?? "");
  const [timezone, setTimezone] = useState(tenant.timezone);
  const [currency, setCurrency] = useState(tenant.defaultCurrency);
  const [saved,    setSaved]    = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Sync form fields when tenant loads (may arrive after mount)
  useEffect(() => {
    setTimezone(tenant.timezone);
    setCurrency(tenant.defaultCurrency);
  }, [tenant.timezone, tenant.defaultCurrency]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch("/api/v1/tenant", {
        defaultCurrency: currency,
        timezone,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "Failed to save");
        return;
      }
      await refresh();
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
      <div>
        <h3 className="text-base font-semibold mb-4">Organisation</h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Organisation name</label>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />Timezone
            </label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {SUPPORTED_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Default currency</label>
            <p className="mb-2 text-xs text-muted-foreground">
              All deals default to this currency. Changing it updates new deals only — existing deal values are not converted.
            </p>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {saving ? "Saving…" : "Save changes"}
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

// ── Tab: Users ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]           = useState<TeamUser[]>(DEMO_USERS);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole,  setInviteRole]  = useState<TeamUser["role"]>("rep");
  const [showInvite,  setShowInvite]  = useState(false);
  const [inviting,    setInviting]    = useState(false);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    await new Promise((r) => setTimeout(r, 600));
    setUsers((us) => [...us, {
      id: Date.now().toString(),
      firstName: inviteEmail.split("@")[0],
      lastName: "",
      email: inviteEmail.trim(),
      role: inviteRole,
      status: "invited",
    }]);
    setInviteEmail("");
    setShowInvite(false);
    setInviting(false);
  };

  const removeUser = (id: string) => setUsers((us) => us.filter((u) => u.id !== id));

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
            <button onClick={() => setShowInvite(false)} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {["User", "Role", "Last active", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                      {u.firstName[0]}{u.lastName[0]}
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
                    : <span className="flex items-center gap-1 text-xs text-yellow-600"><Mail className="h-3 w-3" /> Invited</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => removeUser(u.id)} className="text-muted-foreground hover:text-red-600 transition-colors">
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
  const [integrations, setIntegrations] = useState(INTEGRATIONS);

  const disconnect = (id: string) => {
    setIntegrations((prev) =>
      prev.map((i) => i.id === id ? { ...i, status: "available", account: null } : i)
    );
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
                <button
                  onClick={() => disconnect(intg.id)}
                  className="text-xs text-muted-foreground hover:text-red-600 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted shrink-0">
                Connect
              </button>
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
          <button className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
            Upgrade to Enterprise
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {[
            { label: "AI extractions", used: "8,432", limit: "Unlimited" },
            { label: "Contacts",       used: "1,247", limit: "Unlimited" },
            { label: "Storage",        used: "2.3 GB", limit: "50 GB" },
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
  const [twoFa,   setTwoFa]  = useState(false);

  const DEMO_SESSIONS = [
    { id: "s1", device: "Chrome · Windows",      ip: "192.168.1.10",  lastActive: "Active now",  current: true  },
    { id: "s2", device: "Safari · macOS",         ip: "81.103.45.21",  lastActive: "2 hours ago", current: false },
    { id: "s3", device: "NexCRM Mobile · iOS",    ip: "81.103.45.21",  lastActive: "1 day ago",   current: false },
  ];

  const DEMO_KEYS = [
    { id: "k1", name: "CI/CD Integration",  created: "2026-01-12", lastUsed: "3 days ago",  prefix: "nxc_ci_••••••" },
    { id: "k2", name: "Internal Reporting", created: "2026-02-01", lastUsed: "Today",        prefix: "nxc_rp_••••••" },
  ];

  const [sessions, setSessions] = useState(DEMO_SESSIONS);
  const [apiKeys,  setApiKeys]  = useState(DEMO_KEYS);

  const savePassword = () => {
    if (!pwForm.current || !pwForm.next || pwForm.next !== pwForm.confirm) return;
    setPwSaved(true);
    setPwForm({ current: "", next: "", confirm: "" });
    setTimeout(() => setPwSaved(false), 2500);
  };

  return (
    <div className="space-y-8 max-w-lg">
      {/* Change password */}
      <section>
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
          <Lock className="h-4 w-4" /> Change Password
        </h3>
        <div className="space-y-3">
          {(["current", "next", "confirm"] as const).map((field) => (
            <div key={field}>
              <label className="mb-1.5 block text-sm font-medium capitalize">
                {field === "current" ? "Current password" : field === "next" ? "New password" : "Confirm new password"}
              </label>
              <input
                type="password"
                value={pwForm[field]}
                onChange={(e) => setPwForm((f) => ({ ...f, [field]: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={savePassword}
              disabled={!pwForm.current || !pwForm.next || pwForm.next !== pwForm.confirm}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              Update password
            </button>
            {pwSaved && (
              <span className="flex items-center gap-1 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" /> Password updated
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 2FA */}
      <section>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" /> Two-Factor Authentication
        </h3>
        <div className="flex items-center justify-between rounded-lg border bg-card p-4">
          <div>
            <p className="text-sm font-medium">Authenticator app (TOTP)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {twoFa ? "2FA is enabled — your account is protected." : "Add an extra layer of protection to your account."}
            </p>
          </div>
          <button
            onClick={() => setTwoFa((v) => !v)}
            className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              twoFa ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200" : "bg-primary text-primary-foreground hover:opacity-90"
            )}>
            {twoFa ? "Disable 2FA" : "Enable 2FA"}
          </button>
        </div>
      </section>

      {/* Active sessions */}
      <section>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Monitor className="h-4 w-4" /> Active Sessions
        </h3>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <div>
                <p className="text-sm font-medium">{s.device}</p>
                <p className="text-xs text-muted-foreground">{s.ip} · {s.lastActive}</p>
              </div>
              {s.current ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Current</span>
              ) : (
                <button onClick={() => setSessions((prev) => prev.filter((x) => x.id !== s.id))}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-600 transition-colors">
                  <LogOut className="h-3 w-3" /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* API keys */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Key className="h-4 w-4" /> API Keys
          </h3>
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
                className="text-muted-foreground hover:text-red-600 transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {apiKeys.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No API keys. Create one above.</p>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "general",      label: "General",     icon: Settings  },
  { id: "users",        label: "Users",        icon: Users     },
  { id: "integrations", label: "Integrations", icon: Plug      },
  { id: "billing",      label: "Billing",      icon: CreditCard },
  { id: "security",     label: "Security",     icon: Shield    },
];

export default function SettingsPage() {
  const [tab,  setTab]  = useState<Tab>("general");
  const [user, setUser] = useState<StoredUser | null>(null);
  useEffect(() => { setUser(getStoredUser()); }, []);

  return (
    <div className="flex h-full gap-6">
      <aside className="w-48 shrink-0">
        <nav className="space-y-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                tab === id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 overflow-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold capitalize">{TABS.find((t) => t.id === tab)?.label}</h1>
        </div>
        {tab === "general"      && <GeneralTab user={user} />}
        {tab === "users"        && <UsersTab />}
        {tab === "integrations" && <IntegrationsTab />}
        {tab === "billing"      && <BillingTab />}
        {tab === "security"     && <SecurityTab />}
      </div>
    </div>
  );
}
