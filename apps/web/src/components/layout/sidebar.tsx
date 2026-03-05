"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase, Users, Building2, Zap, BarChart3,
  CheckSquare, Settings, AlertCircle, Layers, ListOrdered,
  LayoutDashboard, Sun, Moon, Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/theme-provider";
import type { Theme } from "@/components/theme/theme-provider";

const navItems = [
  { href: "/dashboard",  icon: LayoutDashboard, label: "Dashboard"   },
  { href: "/pipeline",   icon: Briefcase,       label: "Pipeline"    },
  { href: "/contacts",   icon: Users,           label: "Contacts"    },
  { href: "/companies",  icon: Building2,       label: "Companies"   },
  { href: "/activities", icon: Zap,             label: "Activities"  },
  { href: "/tasks",      icon: CheckSquare,     label: "Tasks"       },
  { href: "/sequences",  icon: ListOrdered,     label: "Sequences"   },
  { href: "/reports",    icon: BarChart3,       label: "Reports"     },
  { href: "/review",     icon: AlertCircle,     label: "Review Queue"},
  { href: "/workflows",  icon: Layers,          label: "Workflows"   },
  { href: "/settings",   icon: Settings,        label: "Settings"    },
];

const THEME_CYCLE: Theme[] = ["light", "dark", "system"];
const THEME_ICONS: Record<Theme, React.FC<{ className?: string }>> = {
  light: Sun, dark: Moon, system: Monitor,
};
const THEME_LABELS: Record<Theme, string> = {
  light: "Light", dark: "Dark", system: "System",
};

export function Sidebar() {
  const pathname  = usePathname();
  const { theme, setTheme } = useTheme();
  const ThemeIcon = THEME_ICONS[theme];

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  return (
    <aside className="flex w-16 flex-col border-r bg-card lg:w-56">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-4">
        <span className="hidden font-bold text-primary lg:block">NexCRM</span>
        <span className="block h-8 w-8 rounded-lg bg-primary lg:hidden" />
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
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

      {/* Bottom: theme toggle + hint */}
      <div className="border-t p-2 space-y-1">
        <button
          onClick={cycleTheme}
          title={"Theme: " + THEME_LABELS[theme] + " — click to cycle"}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ThemeIcon className="h-4 w-4 shrink-0" />
          <span className="hidden lg:block">{THEME_LABELS[theme]}</span>
        </button>
        <div className="hidden px-1 pb-1 lg:block">
          <p className="text-xs text-muted-foreground">
            Press <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">⌘K</kbd> for command bar
          </p>
        </div>
      </div>
    </aside>
  );
}
