"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Zap, Home, Briefcase, Users, Building2, Activity,
  TrendingUp, CheckSquare, BarChart3, Layers, AlertCircle,
  Settings, Bell, ChevronDown, LogOut, User, Search,
  MoreHorizontal, Shield, CreditCard, X, Mail, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth, getStoredUser } from "@/lib/auth";
import { useCommandBarStore } from "@/stores/command-bar-store";
import { usePermissions } from "@/lib/permissions";
import type { StoredUser } from "@/lib/auth";

const PRIMARY_NAV = [
  { href: "/",           icon: Home,       label: "Home"          },
  { href: "/activities", icon: Activity,   label: "Activities"    },
  { href: "/leads",      icon: TrendingUp, label: "Leads"         },
  { href: "/contacts",   icon: Users,      label: "Contacts"      },
  { href: "/pipeline",   icon: Briefcase,  label: "Opportunities" },
  { href: "/companies",  icon: Building2,  label: "Companies"     },
];

const MORE_NAV = [
  { href: "/tasks",     icon: CheckSquare, label: "Tasks"        },
  { href: "/quotes",    icon: FileText,    label: "Quotes"       },
  { href: "/sequences", icon: Mail,        label: "Sequences"    },
  { href: "/reports",   icon: BarChart3,   label: "Reports"      },
  { href: "/review",    icon: AlertCircle, label: "Review Queue" },
  { href: "/workflows", icon: Layers,      label: "Workflows"    },
];

interface Notification {
  id: string; type: string; title: string; body: string; time: string; read: boolean;
}

const INITIAL_NOTIFICATIONS: Notification[] = [
  { id: "1", type: "ai",    title: "7 extractions need review",    body: "AI confidence 75–90% on new emails", time: "2m ago",  read: false },
  { id: "2", type: "deal",  title: "Acme Corp — deal stalling",    body: "No activity in 8 days",              time: "1h ago",  read: false },
  { id: "3", type: "task",  title: "Follow-up with TechStart",     body: "Due today at 5 PM",                  time: "3h ago",  read: false },
  { id: "4", type: "stage", title: "Globex moved to Negotiation",  body: "Stage updated by Sarah Kim",         time: "5h ago",  read: true  },
  { id: "5", type: "ai",    title: "Budget confirmed — Acme Corp", body: "Auto-detected in last email thread", time: "1d ago",  read: true  },
];

function NotificationPanel({
  items, onClose, onMarkRead, onMarkAllRead,
}: {
  items: Notification[];
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  const unread = items.filter((n) => !n.read).length;

  const iconFor = (type: string) => {
    const cls = "h-4 w-4";
    if (type === "ai")    return <Zap className={cn(cls, "text-purple-500")} />;
    if (type === "deal")  return <Briefcase className={cn(cls, "text-orange-500")} />;
    if (type === "task")  return <CheckSquare className={cn(cls, "text-blue-500")} />;
    if (type === "stage") return <TrendingUp className={cn(cls, "text-green-500")} />;
    return <Bell className={cn(cls, "text-muted-foreground")} />;
  };

  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-96 rounded-xl border bg-card shadow-lg overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-foreground" />
          <span className="font-semibold text-sm">Notifications</span>
          {unread > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">{unread}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button onClick={onMarkAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {items.map((n) => (
          <div key={n.id}
            className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50 cursor-pointer", !n.read && "bg-primary/5")}
            onClick={() => onMarkRead(n.id)}>
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              {iconFor(n.type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn("text-sm", !n.read && "font-medium")}>{n.title}</p>
              <p className="text-xs text-muted-foreground truncate">{n.body}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{n.time}</span>
          </div>
        ))}
      </div>
      <div className="border-t px-4 py-2 text-center">
        <button className="text-xs text-primary hover:underline" onClick={onClose}>View all notifications</button>
      </div>
    </div>
  );
}

function ProfileDropdown({ user, onClose }: { user: StoredUser; onClose: () => void }) {
  const router = useRouter();

  const handleLogout = async () => { await clearAuth(); router.replace("/login"); onClose(); };

  const roleBadge: Record<string, string> = {
    super_admin: "bg-red-100 text-red-700",   admin:     "bg-purple-100 text-purple-700",
    manager:     "bg-blue-100 text-blue-700", rep:       "bg-green-100 text-green-700",
    read_only:   "bg-gray-100 text-gray-600",
  };

  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-xl border bg-card shadow-lg overflow-hidden">
      <div className="border-b px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
            {(user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")}
          </div>
          <div className="min-w-0">
            <p className="font-semibold truncate">{user.firstName} {user.lastName}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", roleBadge[user.role] ?? roleBadge.rep)}>
            {user.role.replace("_", " ")}
          </span>
          <span className="text-xs text-muted-foreground">{user.tenantName}</span>
        </div>
      </div>

      <div className="py-1">
        {[
          { icon: User,       label: "My Profile",        href: "/settings?tab=profile"   },
          { icon: Shield,     label: "Security",           href: "/settings?tab=security"  },
          { icon: Settings,   label: "Company Settings",   href: "/settings?tab=general"   },
          { icon: CreditCard, label: "Billing & Plan",     href: "/settings?tab=billing"   },
        ].map(({ icon: Icon, label, href }) => (
          <Link key={href} href={href} onClick={onClose}
            className="flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {label}
          </Link>
        ))}
      </div>

      <div className="border-t py-1">
        <button onClick={handleLogout}
          className="flex w-full items-center gap-3 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50">
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

function MoreMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const isActive = MORE_NAV.some((n) => pathname === n.href);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className={cn("flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
        More
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-xl border bg-card py-1 shadow-lg">
          {MORE_NAV.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}
              className={cn("flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted",
                pathname === href ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="h-4 w-4" />{label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const open     = useCommandBarStore((s) => s.open);

  const [user, setUser]               = useState<StoredUser | null>(null);
  const [showNotif, setShowNotif]     = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // Lift notification state here so badge count stays in sync
  const [notifications, setNotifications] = useState<Notification[]>(INITIAL_NOTIFICATIONS);

  const notifRef   = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setUser(getStoredUser()); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const unread = notifications.filter((n) => !n.read).length;

  const markRead    = (id: string) => setNotifications((ns) => ns.map((n) => n.id === id ? { ...n, read: true } : n));
  const markAllRead = ()            => setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center border-b bg-card px-4 gap-3">
      <Link href="/" className="flex items-center gap-2 rounded-md px-1 py-1 transition-opacity hover:opacity-80">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-bold text-foreground hidden sm:block">NexCRM</span>
      </Link>

      <div className="h-5 w-px bg-border" />

      <nav className="flex items-center gap-0.5">
        {PRIMARY_NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href}
              className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden lg:block">{label}</span>
            </Link>
          );
        })}
        <MoreMenu pathname={pathname} />
      </nav>

      <div className="flex-1" />

      {/* Search trigger */}
      <button onClick={open}
        className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors">
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:block">Search…</span>
        <kbd className="hidden md:inline rounded border bg-background px-1.5 py-0.5 font-mono text-xs">⌘K</kbd>
      </button>

      {/* Admin — super_admin only */}
      {usePermissions().isSuperAdmin && (
        <Link href="/admin"
          className={cn("rounded-md p-2 text-red-600 hover:bg-red-50 transition-colors",
            pathname.startsWith("/admin") && "bg-red-100")}
          title="Platform Admin">
          <Shield className="h-4 w-4" />
        </Link>
      )}

      {/* Settings */}
      <Link href="/settings"
        className={cn("rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
          pathname.startsWith("/settings") && "bg-primary/10 text-primary")}>
        <Settings className="h-4 w-4" />
      </Link>

      {/* Notifications */}
      <div ref={notifRef} className="relative">
        <button
          onClick={() => { setShowNotif((v) => !v); setShowProfile(false); }}
          className={cn("relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
            showNotif && "bg-muted text-foreground")}>
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {unread}
            </span>
          )}
        </button>
        {showNotif && (
          <NotificationPanel
            items={notifications}
            onClose={() => setShowNotif(false)}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
          />
        )}
      </div>

      {/* Profile */}
      <div ref={profileRef} className="relative">
        <button
          onClick={() => { setShowProfile((v) => !v); setShowNotif(false); }}
          className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
            showProfile && "bg-muted")}>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            {user ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}` : <User className="h-4 w-4" />}
          </div>
          {user && <span className="hidden lg:block text-foreground">{user.firstName}</span>}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
        </button>
        {showProfile && user && (
          <ProfileDropdown user={user} onClose={() => setShowProfile(false)} />
        )}
      </div>
    </header>
  );
}
