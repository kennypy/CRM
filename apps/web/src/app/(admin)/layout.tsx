"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield, Building2, GitMerge, BarChart3, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { href: "/admin", icon: Shield, label: "Overview" },
  { href: "/admin/workspaces", icon: Building2, label: "Workspaces" },
  { href: "/admin/merges", icon: GitMerge, label: "Merges" },
  { href: "/admin/reports", icon: BarChart3, label: "Reports" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center border-b bg-card px-4 gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to CRM
        </Link>

        <div className="h-5 w-px bg-border" />

        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-600">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold text-foreground">Platform Admin</span>
        </div>

        <div className="h-5 w-px bg-border" />

        <nav className="flex items-center gap-0.5">
          {ADMIN_NAV.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
