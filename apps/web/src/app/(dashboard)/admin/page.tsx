"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { getStoredUser } from "@/lib/auth";
import {
  Users, Shield, FileText, Database, Activity, Settings,
  Plus, Trash2, Search, Download, Upload, RefreshCw,
  CheckCircle2, AlertCircle, XCircle, Clock, Lock,
  Eye, Edit, ChevronDown, ChevronRight, X, Filter,
  Globe, Key, Monitor, ToggleLeft, ToggleRight,
  HardDrive, Cpu, Wifi, Zap, AlertTriangle, Info,
  UserPlus, UserMinus, Mail, Copy, MoreVertical,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = "users" | "roles" | "audit" | "security" | "data" | "health";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "inactive" | "invited";
  lastLogin: string | null;
  twoFaEnabled: boolean;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  details: string;
  ip: string;
}

interface DSRRequest {
  id: string;
  type: "access" | "deletion" | "portability" | "rectification";
  subject: string;
  email: string;
  status: "pending" | "in_progress" | "completed";
  requestedAt: string;
  dueBy: string;
}

// ── Demo Data ──────────────────────────────────────────────────────────────────

const DEMO_USERS: AdminUser[] = [
  { id: "u1", name: "Sarah Kim",       email: "sarah@acme.com",   role: "admin",     status: "active",   lastLogin: "2026-03-08 09:14", twoFaEnabled: true  },
  { id: "u2", name: "Marcus Chen",     email: "marcus@acme.com",  role: "manager",   status: "active",   lastLogin: "2026-03-07 16:42", twoFaEnabled: true  },
  { id: "u3", name: "Priya Sharma",    email: "priya@acme.com",   role: "rep",       status: "active",   lastLogin: "2026-03-08 08:30", twoFaEnabled: false },
  { id: "u4", name: "Alex Johnson",    email: "alex@acme.com",    role: "rep",       status: "active",   lastLogin: "2026-03-06 11:20", twoFaEnabled: false },
  { id: "u5", name: "Jamie Rodriguez", email: "jamie@acme.com",   role: "read_only", status: "inactive", lastLogin: "2026-02-15 14:00", twoFaEnabled: false },
  { id: "u6", name: "Dana Lee",        email: "dana@acme.com",    role: "rep",       status: "invited",  lastLogin: null,               twoFaEnabled: false },
];

const DEMO_AUDIT: AuditEntry[] = [
  { id: "a1", timestamp: "2026-03-08 09:14:32", user: "Sarah Kim",    action: "user.login",       entity: "User",    entityId: "u1", details: "Successful login",                      ip: "203.0.113.42" },
  { id: "a2", timestamp: "2026-03-08 09:10:05", user: "Sarah Kim",    action: "user.role_change", entity: "User",    entityId: "u4", details: "Changed role from read_only to rep",    ip: "203.0.113.42" },
  { id: "a3", timestamp: "2026-03-07 16:42:11", user: "Marcus Chen",  action: "deal.update",      entity: "Deal",    entityId: "d47", details: "Stage changed: Proposal → Negotiation", ip: "198.51.100.7" },
  { id: "a4", timestamp: "2026-03-07 15:30:00", user: "Priya Sharma", action: "contact.create",   entity: "Contact", entityId: "c92", details: "Created contact: John Doe",             ip: "192.0.2.15"   },
  { id: "a5", timestamp: "2026-03-07 14:15:22", user: "Marcus Chen",  action: "report.export",    entity: "Report",  entityId: "r12", details: "Exported pipeline report as CSV",       ip: "198.51.100.7" },
  { id: "a6", timestamp: "2026-03-07 11:00:00", user: "Sarah Kim",    action: "security.2fa",     entity: "User",    entityId: "u1", details: "Enabled 2FA for account",               ip: "203.0.113.42" },
  { id: "a7", timestamp: "2026-03-06 17:20:33", user: "Alex Johnson", action: "deal.create",      entity: "Deal",    entityId: "d48", details: "Created deal: Acme Enterprise Plan",    ip: "172.16.0.5"   },
  { id: "a8", timestamp: "2026-03-06 09:45:10", user: "Sarah Kim",    action: "user.invite",      entity: "User",    entityId: "u6", details: "Invited dana@acme.com as rep",          ip: "203.0.113.42" },
];

const DEMO_DSR: DSRRequest[] = [
  { id: "dsr1", type: "access",      subject: "John Doe",     email: "john@example.com",  status: "completed",   requestedAt: "2026-02-20", dueBy: "2026-03-20" },
  { id: "dsr2", type: "deletion",    subject: "Jane Smith",   email: "jane@example.com",  status: "in_progress", requestedAt: "2026-03-01", dueBy: "2026-03-31" },
  { id: "dsr3", type: "portability", subject: "Bob Wilson",   email: "bob@example.com",   status: "pending",     requestedAt: "2026-03-05", dueBy: "2026-04-04" },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", manager: "Manager", rep: "Rep", read_only: "Read Only",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  admin:       "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  manager:     "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  rep:         "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  read_only:   "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const STATUS_COLORS: Record<string, string> = {
  active:   "text-green-600 dark:text-green-400",
  inactive: "text-gray-400",
  invited:  "text-amber-500 dark:text-amber-400",
};

const PERMISSION_CATEGORIES = {
  CRM: [
    "contacts.view", "contacts.create", "contacts.edit", "contacts.delete",
    "deals.view", "deals.create", "deals.edit", "deals.delete",
    "companies.view", "companies.create", "companies.edit", "companies.delete",
  ],
  AI: [
    "ai.suggestions", "ai.email_draft", "ai.call_summary", "ai.forecasting",
  ],
  Reports: [
    "reports.view", "reports.create", "reports.export", "reports.schedule",
  ],
  Admin: [
    "admin.users", "admin.roles", "admin.audit_log", "admin.security",
    "admin.data_management", "admin.system_health",
  ],
  Billing: [
    "billing.view", "billing.manage", "billing.invoices",
  ],
};

const BUILT_IN_ROLES = [
  { name: "Admin",     description: "Full access to all features and settings",   permissions: "All permissions" },
  { name: "Manager",   description: "Team management, reporting, and CRM write",  permissions: "CRM.*, Reports.*, AI.*" },
  { name: "Rep",       description: "Standard CRM access with AI assistance",     permissions: "CRM.(view,create,edit), AI.*, Reports.view" },
  { name: "Read Only", description: "View-only access to CRM data",              permissions: "CRM.view, Reports.view" },
];

const SERVICES = [
  { name: "API Server",       status: "healthy",  latency: "24ms",  uptime: "99.98%" },
  { name: "Database",         status: "healthy",  latency: "3ms",   uptime: "99.99%" },
  { name: "Redis Cache",      status: "healthy",  latency: "1ms",   uptime: "99.99%" },
  { name: "Email Service",    status: "healthy",  latency: "142ms", uptime: "99.95%" },
  { name: "AI Engine",        status: "degraded", latency: "890ms", uptime: "99.80%" },
  { name: "File Storage",     status: "healthy",  latency: "35ms",  uptime: "99.97%" },
  { name: "Search Index",     status: "healthy",  latency: "12ms",  uptime: "99.96%" },
  { name: "Background Jobs",  status: "healthy",  latency: "—",     uptime: "99.94%" },
];

const WEBHOOKS = [
  { url: "https://hooks.slack.com/services/T01/B02/abc", events: "deal.won, deal.lost", status: "active",  lastFired: "2 min ago",  successRate: "100%" },
  { url: "https://api.zapier.com/hooks/catch/123",       events: "contact.created",      status: "active",  lastFired: "15 min ago", successRate: "99.8%" },
  { url: "https://n8n.internal/webhook/crm-sync",        events: "deal.stage_change",    status: "failing", lastFired: "1 hr ago",   successRate: "87.2%" },
];

// ── Tab Navigation ─────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: "users",    label: "Users",              icon: Users    },
  { key: "roles",    label: "Roles & Permissions", icon: Shield   },
  { key: "audit",    label: "Audit Log",           icon: FileText },
  { key: "security", label: "Security",            icon: Lock     },
  { key: "data",     label: "Data Management",     icon: Database },
  { key: "health",   label: "System Health",        icon: Activity },
];

// ── Users Tab ──────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState(DEMO_USERS);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("rep");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function handleInvite() {
    if (!inviteEmail) return;
    const newUser: AdminUser = {
      id: `u${Date.now()}`,
      name: inviteEmail.split("@")[0],
      email: inviteEmail,
      role: inviteRole,
      status: "invited",
      lastLogin: null,
      twoFaEnabled: false,
    };
    setUsers((prev) => [...prev, newUser]);
    setInviteEmail("");
    setShowInvite(false);
  }

  function toggleStatus(id: string) {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id
          ? { ...u, status: u.status === "active" ? "inactive" : "active" }
          : u
      )
    );
  }

  function changeRole(id: string, role: string) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">User Management</h2>
          <p className="text-sm text-muted-foreground">
            {users.filter((u) => u.status === "active").length} active users &middot;{" "}
            {users.filter((u) => u.status === "invited").length} pending invites
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" /> Invite User
        </button>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Invite New User</h3>
            <button onClick={() => setShowInvite(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Email Address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@company.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="w-40">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="rep">Rep</option>
                <option value="read_only">Read Only</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleInvite}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Mail className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search users..."
          className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Login</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{user.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={user.role}
                    onChange={(e) => changeRole(user.id, e.target.value)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium border-0 cursor-pointer",
                      ROLE_COLORS[user.role] ?? ROLE_COLORS.read_only
                    )}
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="rep">Rep</option>
                    <option value="read_only">Read Only</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("flex items-center gap-1.5 text-xs font-medium", STATUS_COLORS[user.status])}>
                    {user.status === "active" && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {user.status === "inactive" && <XCircle className="h-3.5 w-3.5" />}
                    {user.status === "invited" && <Clock className="h-3.5 w-3.5" />}
                    {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{user.lastLogin ?? "Never"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleStatus(user.id)}
                    className={cn(
                      "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                      user.status === "active"
                        ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        : "text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                    )}
                  >
                    {user.status === "active" ? "Deactivate" : "Reactivate"}
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

// ── Roles & Permissions Tab ────────────────────────────────────────────────────

function RolesTab() {
  const [customRoleName, setCustomRoleName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [expandedCategory, setExpandedCategory] = useState<string | null>("CRM");

  function togglePermission(perm: string) {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  function toggleCategory(cat: string) {
    const perms = PERMISSION_CATEGORIES[cat as keyof typeof PERMISSION_CATEGORIES];
    const allSelected = perms.every((p) => selectedPermissions.has(p));
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      perms.forEach((p) => (allSelected ? next.delete(p) : next.add(p)));
      return next;
    });
  }

  return (
    <div className="space-y-8">
      {/* Built-in Roles */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Built-in Roles</h2>
        <p className="text-sm text-muted-foreground mb-4">These roles are predefined and cannot be deleted.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {BUILT_IN_ROLES.map((role) => (
            <div key={role.name} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-4 w-4 text-primary" />
                <h3 className="font-medium">{role.name}</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-2">{role.description}</p>
              <p className="text-xs font-mono text-muted-foreground bg-muted/50 rounded px-2 py-1">{role.permissions}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Role Builder */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Custom Role Builder</h2>
        <p className="text-sm text-muted-foreground mb-4">Create a custom role with specific permissions.</p>

        <div className="rounded-xl border border-border bg-card p-5 space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium">Role Name</label>
            <input
              value={customRoleName}
              onChange={(e) => setCustomRoleName(e.target.value)}
              placeholder="e.g., Sales Lead"
              className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Permissions</label>
            {Object.entries(PERMISSION_CATEGORIES).map(([cat, perms]) => {
              const allSelected = perms.every((p) => selectedPermissions.has(p));
              const someSelected = perms.some((p) => selectedPermissions.has(p));
              const isExpanded = expandedCategory === cat;

              return (
                <div key={cat} className="rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setExpandedCategory(isExpanded ? null : cat)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span>{cat}</span>
                      {someSelected && (
                        <span className="text-xs text-muted-foreground">
                          ({perms.filter((p) => selectedPermissions.has(p)).length}/{perms.length})
                        </span>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => toggleCategory(cat)}
                        className="rounded border-border"
                      />
                      All
                    </label>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border px-4 py-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {perms.map((perm) => (
                        <label key={perm} className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={selectedPermissions.has(perm)}
                            onChange={() => togglePermission(perm)}
                            className="rounded border-border"
                          />
                          {perm.split(".").pop()?.replace(/_/g, " ")}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              disabled={!customRoleName || selectedPermissions.size === 0}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Custom Role
            </button>
            <span className="text-xs text-muted-foreground">
              {selectedPermissions.size} permission{selectedPermissions.size !== 1 ? "s" : ""} selected
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Audit Log Tab ──────────────────────────────────────────────────────────────

function AuditTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const uniqueUsers = [...new Set(DEMO_AUDIT.map((a) => a.user))];
  const uniqueActions = [...new Set(DEMO_AUDIT.map((a) => a.action))];
  const uniqueEntities = [...new Set(DEMO_AUDIT.map((a) => a.entity))];

  const filtered = DEMO_AUDIT.filter((entry) => {
    if (searchQuery && !entry.details.toLowerCase().includes(searchQuery.toLowerCase()) && !entry.user.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterUser && entry.user !== filterUser) return false;
    if (filterAction && entry.action !== filterAction) return false;
    if (filterEntity && entry.entity !== filterEntity) return false;
    if (filterDateFrom && entry.timestamp < filterDateFrom) return false;
    if (filterDateTo && entry.timestamp > filterDateTo + " 23:59:59") return false;
    return true;
  });

  function exportCSV() {
    const header = "Timestamp,User,Action,Entity,Entity ID,Details,IP\n";
    const rows = filtered.map((e) => `"${e.timestamp}","${e.user}","${e.action}","${e.entity}","${e.entityId}","${e.details}","${e.ip}"`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Audit Log</h2>
          <p className="text-sm text-muted-foreground">Track all user actions and system events.</p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search audit log..."
            className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none">
          <option value="">All Users</option>
          {uniqueUsers.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none">
          <option value="">All Actions</option>
          {uniqueActions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none">
          <option value="">All Entities</option>
          {uniqueEntities.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none" />
        <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none" />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Timestamp</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Action</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Entity</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Details</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap font-mono">{entry.timestamp}</td>
                <td className="px-4 py-3 font-medium whitespace-nowrap">{entry.user}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono">{entry.action}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{entry.entity}</td>
                <td className="px-4 py-3 text-muted-foreground">{entry.details}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{entry.ip}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No audit entries match your filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">Showing {filtered.length} of {DEMO_AUDIT.length} entries</p>
    </div>
  );
}

// ── Security Tab ───────────────────────────────────────────────────────────────

function SecurityTab() {
  const [minPasswordLength, setMinPasswordLength] = useState(12);
  const [requireUppercase, setRequireUppercase] = useState(true);
  const [requireNumbers, setRequireNumbers] = useState(true);
  const [requireSpecial, setRequireSpecial] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState(480);
  const [enforce2FA, setEnforce2FA] = useState(false);
  const [ipAllowlist, setIpAllowlist] = useState("203.0.113.0/24\n198.51.100.0/24");
  const [ipAllowlistEnabled, setIpAllowlistEnabled] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoProvider, setSsoProvider] = useState("okta");
  const [ssoEntityId, setSsoEntityId] = useState("https://acme.okta.com/app/exk123abc");
  const [ssoAcsUrl, setSsoAcsUrl] = useState("https://app.nexcrm.com/api/auth/saml/callback");
  const [scimEnabled, setScimEnabled] = useState(false);
  const [scimToken, setScimToken] = useState("scim_tok_••••••••••••••••");

  return (
    <div className="space-y-8">
      {/* Password Policy */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Key className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Password Policy</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Minimum Length</label>
            <input
              type="number"
              min={8}
              max={128}
              value={minPasswordLength}
              onChange={(e) => setMinPasswordLength(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="space-y-2 pt-1">
            {[
              { label: "Require uppercase letters", value: requireUppercase, set: setRequireUppercase },
              { label: "Require numbers",           value: requireNumbers,   set: setRequireNumbers },
              { label: "Require special characters", value: requireSpecial,  set: setRequireSpecial },
            ].map(({ label, value, set }) => (
              <label key={label} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={value} onChange={() => set(!value)} className="rounded border-border" />
                {label}
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* Session & 2FA */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Monitor className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Sessions & Two-Factor Authentication</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Session Timeout (minutes)</label>
            <select
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={240}>4 hours</option>
              <option value={480}>8 hours</option>
              <option value={1440}>24 hours</option>
            </select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Enforce 2FA for all users</p>
              <p className="text-xs text-muted-foreground">Require two-factor authentication on next login</p>
            </div>
            <button onClick={() => setEnforce2FA(!enforce2FA)} className="text-muted-foreground hover:text-foreground transition-colors">
              {enforce2FA ? <ToggleRight className="h-8 w-8 text-primary" /> : <ToggleLeft className="h-8 w-8" />}
            </button>
          </div>
        </div>
      </section>

      {/* IP Allowlist */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">IP Allowlist</h2>
          </div>
          <button onClick={() => setIpAllowlistEnabled(!ipAllowlistEnabled)} className="text-muted-foreground hover:text-foreground transition-colors">
            {ipAllowlistEnabled ? <ToggleRight className="h-8 w-8 text-primary" /> : <ToggleLeft className="h-8 w-8" />}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">Only allow access from these IP addresses / CIDR ranges (one per line).</p>
        <textarea
          value={ipAllowlist}
          onChange={(e) => setIpAllowlist(e.target.value)}
          rows={4}
          disabled={!ipAllowlistEnabled}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
      </section>

      {/* SSO / SAML */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">SSO / SAML Configuration</h2>
          </div>
          <button onClick={() => setSsoEnabled(!ssoEnabled)} className="text-muted-foreground hover:text-foreground transition-colors">
            {ssoEnabled ? <ToggleRight className="h-8 w-8 text-primary" /> : <ToggleLeft className="h-8 w-8" />}
          </button>
        </div>
        {ssoEnabled && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Identity Provider</label>
              <select
                value={ssoProvider}
                onChange={(e) => setSsoProvider(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="okta">Okta</option>
                <option value="azure">Azure AD</option>
                <option value="google">Google Workspace</option>
                <option value="onelogin">OneLogin</option>
                <option value="custom">Custom SAML</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Entity ID / Issuer</label>
              <input
                value={ssoEntityId}
                onChange={(e) => setSsoEntityId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">ACS URL (Assertion Consumer Service)</label>
              <input
                value={ssoAcsUrl}
                onChange={(e) => setSsoAcsUrl(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        )}
      </section>

      {/* SCIM */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">SCIM Provisioning</h2>
          </div>
          <button onClick={() => setScimEnabled(!scimEnabled)} className="text-muted-foreground hover:text-foreground transition-colors">
            {scimEnabled ? <ToggleRight className="h-8 w-8 text-primary" /> : <ToggleLeft className="h-8 w-8" />}
          </button>
        </div>
        {scimEnabled && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm">SCIM endpoint active &middot; Last sync: 4 hours ago</span>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">SCIM Bearer Token</label>
              <div className="flex gap-2">
                <input
                  value={scimToken}
                  readOnly
                  className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm font-mono outline-none"
                />
                <button className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted transition-colors">
                  <Copy className="h-4 w-4" />
                </button>
                <button className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted transition-colors">
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          Save Security Settings
        </button>
      </div>
    </div>
  );
}

// ── Data Management Tab ────────────────────────────────────────────────────────

function DataTab() {
  const [retentionMonths, setRetentionMonths] = useState(24);
  const [autoDeleteInactive, setAutoDeleteInactive] = useState(false);

  return (
    <div className="space-y-8">
      {/* Export */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Data Export</h2>
        </div>
        <p className="text-sm text-muted-foreground">Export your CRM data for backup or migration purposes.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Contacts (JSON)",  icon: Download, format: "json" },
            { label: "Contacts (CSV)",   icon: Download, format: "csv"  },
            { label: "Deals (JSON)",     icon: Download, format: "json" },
            { label: "Deals (CSV)",      icon: Download, format: "csv"  },
            { label: "Companies (JSON)", icon: Download, format: "json" },
            { label: "Companies (CSV)",  icon: Download, format: "csv"  },
            { label: "Activities (JSON)", icon: Download, format: "json" },
            { label: "Full Backup (JSON)", icon: Download, format: "json" },
          ].map((item) => (
            <button
              key={item.label}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <item.icon className="h-4 w-4 text-muted-foreground" />
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {/* Import */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Upload className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Data Import</h2>
        </div>
        <p className="text-sm text-muted-foreground">Import data from CSV files. Supported entities: contacts, companies, deals.</p>
        <div className="flex items-center gap-4 rounded-lg border-2 border-dashed border-border p-6">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium">Drop a CSV file here or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">Maximum file size: 50 MB. Headers must match the entity schema.</p>
          </div>
          <label className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Browse
            <input type="file" accept=".csv" className="hidden" />
          </label>
        </div>
      </section>

      {/* Retention */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Retention Policies</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Data Retention Period</label>
            <select
              value={retentionMonths}
              onChange={(e) => setRetentionMonths(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
              <option value={24}>24 months</option>
              <option value={36}>36 months</option>
              <option value={60}>5 years</option>
              <option value={0}>Indefinite</option>
            </select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Auto-delete inactive contacts</p>
              <p className="text-xs text-muted-foreground">Remove contacts with no activity past retention period</p>
            </div>
            <button onClick={() => setAutoDeleteInactive(!autoDeleteInactive)} className="text-muted-foreground hover:text-foreground transition-colors">
              {autoDeleteInactive ? <ToggleRight className="h-8 w-8 text-primary" /> : <ToggleLeft className="h-8 w-8" />}
            </button>
          </div>
        </div>
      </section>

      {/* GDPR DSR */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">GDPR Data Subject Requests</h2>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Subject</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Requested</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Due By</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_DSR.map((dsr) => (
                <tr key={dsr.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">{dsr.type}</span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{dsr.subject}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{dsr.email}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      "flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      dsr.status === "completed"   && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                      dsr.status === "in_progress" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                      dsr.status === "pending"     && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                    )}>
                      {dsr.status === "completed" && <CheckCircle2 className="h-3 w-3" />}
                      {dsr.status === "in_progress" && <RefreshCw className="h-3 w-3" />}
                      {dsr.status === "pending" && <Clock className="h-3 w-3" />}
                      {dsr.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{dsr.requestedAt}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{dsr.dueBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── System Health Tab ──────────────────────────────────────────────────────────

function HealthTab() {
  const statusColor = (s: string) =>
    s === "healthy" ? "text-green-500" : s === "degraded" ? "text-amber-500" : "text-red-500";
  const statusBg = (s: string) =>
    s === "healthy" ? "bg-green-50 dark:bg-green-900/20" : s === "degraded" ? "bg-amber-50 dark:bg-amber-900/20" : "bg-red-50 dark:bg-red-900/20";
  const statusIcon = (s: string) =>
    s === "healthy" ? <CheckCircle2 className="h-4 w-4" /> : s === "degraded" ? <AlertTriangle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />;

  return (
    <div className="space-y-8">
      {/* Service Status */}
      <section>
        <h2 className="text-lg font-semibold mb-1">Service Status</h2>
        <p className="text-sm text-muted-foreground mb-4">Real-time health of all system components.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((svc) => (
            <div key={svc.name} className={cn("rounded-xl border border-border p-4", statusBg(svc.status))}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{svc.name}</span>
                <span className={statusColor(svc.status)}>{statusIcon(svc.status)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Latency: {svc.latency}</span>
                <span>Uptime: {svc.uptime}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* API Rate Limits */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">API Rate Limits</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { label: "Requests (this hour)", used: 1247, limit: 10000 },
            { label: "Requests (today)",     used: 18432, limit: 100000 },
            { label: "Bulk operations",      used: 3, limit: 50 },
          ].map((r) => {
            const pct = Math.round((r.used / r.limit) * 100);
            return (
              <div key={r.label} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{r.label}</span>
                  <span className="text-muted-foreground">{r.used.toLocaleString()} / {r.limit.toLocaleString()}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct < 70 ? "bg-green-500" : pct < 90 ? "bg-amber-500" : "bg-red-500"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-right">{pct}% used</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Storage & AI Usage */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Storage Usage</h2>
          </div>
          <div className="space-y-3">
            {[
              { label: "Database",    used: "2.4 GB",  limit: "10 GB",  pct: 24 },
              { label: "File Storage", used: "890 MB",  limit: "5 GB",   pct: 17 },
              { label: "Backups",     used: "1.2 GB",  limit: "5 GB",   pct: 24 },
            ].map((s) => (
              <div key={s.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{s.label}</span>
                  <span className="text-muted-foreground">{s.used} / {s.limit}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${s.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">AI Token Consumption</h2>
          </div>
          <div className="space-y-3">
            {[
              { label: "Email Drafts",     used: "12,400",  limit: "50,000",  pct: 25 },
              { label: "Call Summaries",    used: "3,200",   limit: "20,000",  pct: 16 },
              { label: "Deal Scoring",      used: "8,100",   limit: "30,000",  pct: 27 },
              { label: "Forecasting",       used: "1,800",   limit: "10,000",  pct: 18 },
            ].map((t) => (
              <div key={t.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{t.label}</span>
                  <span className="text-muted-foreground">{t.used} / {t.limit}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${t.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Webhooks */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Wifi className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Webhook Status</h2>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Endpoint</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Events</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Last Fired</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Success Rate</th>
              </tr>
            </thead>
            <tbody>
              {WEBHOOKS.map((wh, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-xs font-mono truncate max-w-[250px]">{wh.url}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{wh.events}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      "flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      wh.status === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    )}>
                      {wh.status === "active" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {wh.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{wh.lastFired}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{wh.successRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Background Jobs */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <RefreshCw className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Background Jobs</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { name: "Email Sync",       status: "running",   lastRun: "2 min ago",  nextRun: "in 3 min",  queue: 0  },
            { name: "AI Enrichment",    status: "running",   lastRun: "5 min ago",  nextRun: "in 10 min", queue: 12 },
            { name: "Report Generation", status: "idle",      lastRun: "1 hr ago",   nextRun: "in 23 hr",  queue: 0  },
            { name: "Data Cleanup",     status: "scheduled", lastRun: "24 hr ago",  nextRun: "in 12 hr",  queue: 0  },
          ].map((job) => (
            <div key={job.name} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{job.name}</span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  job.status === "running"   && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                  job.status === "idle"       && "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                  job.status === "scheduled" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                )}>
                  {job.status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Last: {job.lastRun}</p>
                <p>Next: {job.nextRun}</p>
                {job.queue > 0 && <p className="text-amber-500">{job.queue} items queued</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const { isAdmin, canManageUsers } = usePermissions();
  const user = getStoredUser();

  if (!isAdmin) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center space-y-3">
          <Shield className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Access Denied</h2>
          <p className="text-sm text-muted-foreground">You need Admin privileges to access the Admin Console.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Console</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage users, security, data, and system health for your organization.
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              activeTab === key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "users"    && <UsersTab />}
        {activeTab === "roles"    && <RolesTab />}
        {activeTab === "audit"    && <AuditTab />}
        {activeTab === "security" && <SecurityTab />}
        {activeTab === "data"     && <DataTab />}
        {activeTab === "health"   && <HealthTab />}
      </div>
    </div>
  );
}
