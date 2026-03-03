"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";
import { api } from "@/lib/api";
import {
  Settings, Users, Plug, CreditCard, Shield,
  Plus, Trash2, Mail, CheckCircle2, AlertCircle,
  Edit2, Globe, Clock,
} from "lucide-react";
import type { StoredUser } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  { id: "1", firstName: "Sarah",   lastName: "Kim",       email: "sarah@acme.com",   role: "admin",   lastLoginAt: "2h ago",   status: "active" },
  { id: "2", firstName: "Marcus",  lastName: "Chen",      email: "marcus@acme.com",  role: "manager", lastLoginAt: "1d ago",   status: "active" },
  { id: "3", firstName: "Priya",   lastName: "Sharma",    email: "priya@acme.com",   role: "rep",     lastLoginAt: "3h ago",   status: "active" },
  { id: "4", firstName: "Alex",    lastName: "Johnson",   email: "alex@acme.com",    role: "rep",     lastLoginAt: "5h ago",   status: "active" },
  { id: "5", firstName: "Jamie",   lastName: "Rodriguez", email: "jamie@acme.com",   role: "rep",     lastLoginAt: undefined,  status: "invited" },
];

const INTEGRATIONS = [
  { id: "gmail",    name: "Gmail",                icon: "📧", status: "connected", desc: "Email ingestion active" },
  { id: "gcal",     name: "Google Calendar",       icon: "📅", status: "connected", desc: "Meetings auto-captured" },
  { id: "outlook",  name: "Outlook / MS365",       icon: "📬", status: "available", desc: "Connect to ingest Outlook mail" },
  { id: "slack",    name: "Slack",                 icon: "💬", status: "available", desc: "Deal alerts & notifications" },
  { id: "zoom",     name: "Zoom",                  icon: "🎥", status: "available", desc: "Auto-transcribe meetings" },
  { id: "stripe",   name: "Stripe",                icon: "💳", status: "available", desc: "Revenue data sync" },
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

type Tab = "general" | "users" | "integrations" | "billing" | "security";

// ── Tab: General ──────────────────────────────────────────────────────────────

function GeneralTab({ user }: { user: StoredUser | null }) {
  const [orgName, setOrgName]       = useState(user?.tenantName ?? "");
  const [timezone, setTimezone]     = useState("America/New_York");
  const [currency, setCurrency]     = useState("USD");
  const [saved, setSaved]           = useState(false);

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

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
            <label className="mb-1.5 block text-sm font-medium flex items-center gap-2"><Globe className="h-4 w-4" />Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Chicago">Central Time (CT)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
              <option value="Europe/London">London (GMT)</option>
              <option value="Europe/Berlin">Central Europe (CET)</option>
              <option value="Asia/Singapore">Singapore (SGT)</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Default currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {["USD", "EUR", "GBP", "CAD", "AUD", "SGD"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Save changes
        </button>
        {saved && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" /> Saved!</span>}
      </div>
    </div>
  );
}

// ── Tab: Users ────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]         = useState<TeamUser[]>(DEMO_USERS);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole]   = useState<TeamUser["role"]>("rep");
  const [showInvite, setShowInvite]   = useState(false);
  const [inviting, setInviting]       = useState(false);

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
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {u.lastLoginAt ?? "Never"}
                </td>
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

// ── Tab: Integrations ─────────────────────────────────────────────────────────

function IntegrationsTab() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {INTEGRATIONS.map((intg) => (
        <div key={intg.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{intg.icon}</span>
              <div>
                <p className="font-medium text-sm">{intg.name}</p>
                <p className="text-xs text-muted-foreground">{intg.desc}</p>
              </div>
            </div>
            {intg.status === "connected" ? (
              <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 shrink-0">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
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

// ── Tab: Billing ──────────────────────────────────────────────────────────────

function BillingTab() {
  return (
    <div className="space-y-6 max-w-2xl">
      {/* Current plan */}
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
            { label: "Contacts",       used: "1,247",  limit: "Unlimited" },
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

      {/* Payment method */}
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

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "general",      label: "General",      icon: Settings  },
  { id: "users",        label: "Users",         icon: Users     },
  { id: "integrations", label: "Integrations",  icon: Plug      },
  { id: "billing",      label: "Billing",       icon: CreditCard },
  { id: "security",     label: "Security",      icon: Shield    },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("general");
  const [user, setUser] = useState<StoredUser | null>(null);
  useEffect(() => { setUser(getStoredUser()); }, []);

  return (
    <div className="flex h-full gap-6">
      {/* Sidebar tabs */}
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

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold capitalize">{TABS.find((t) => t.id === tab)?.label}</h1>
        </div>
        {tab === "general"      && <GeneralTab user={user} />}
        {tab === "users"        && <UsersTab />}
        {tab === "integrations" && <IntegrationsTab />}
        {tab === "billing"      && <BillingTab />}
        {tab === "security"     && (
          <div className="space-y-4 max-w-lg text-sm text-muted-foreground">
            <p>Password management, 2FA, and session controls are coming in Phase 2.</p>
          </div>
        )}
      </div>
    </div>
  );
}
