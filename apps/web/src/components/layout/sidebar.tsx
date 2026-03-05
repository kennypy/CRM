"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Briefcase,
  Users,
  Building2,
  Zap,
  BarChart3,
  CheckSquare,
  Settings,
  AlertCircle,
  Layers,
  ListOrdered,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/pipeline", icon: Briefcase, label: "Pipeline" },
  { href: "/contacts", icon: Users, label: "Contacts" },
  { href: "/companies", icon: Building2, label: "Companies" },
  { href: "/activities", icon: Zap, label: "Activities" },
  { href: "/tasks", icon: CheckSquare, label: "Tasks" },
  { href: "/sequences", icon: ListOrdered, label: "Sequences" },
  { href: "/reports", icon: BarChart3, label: "Reports" },
  { href: "/review", icon: AlertCircle, label: "Review Queue" },
  { href: "/workflows", icon: Layers, label: "Workflows" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-16 flex-col border-r bg-card lg:w-56">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-4">
        <span className="hidden font-bold text-primary lg:block">NexCRM</span>
        <span className="block h-8 w-8 rounded-lg bg-primary lg:hidden" />
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden lg:block">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Keyboard hint */}
      <div className="hidden border-t p-4 lg:block">
        <p className="text-xs text-muted-foreground">
          Press{" "}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
            ⌘K
          </kbd>{" "}
          for command bar
        </p>
      </div>
    </aside>
  );
}
