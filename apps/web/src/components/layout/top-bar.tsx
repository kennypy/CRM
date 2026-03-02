"use client";

import { Search, Bell, User } from "lucide-react";
import { useCommandBarStore } from "@/stores/command-bar-store";

export function TopBar() {
  const open = useCommandBarStore((s) => s.open);

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      {/* Search / command bar trigger */}
      <button
        onClick={open}
        className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search or ask anything…</span>
        <kbd className="ml-2 hidden rounded border bg-background px-1.5 py-0.5 font-mono text-xs sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Bell className="h-4 w-4" />
          {/* Unread badge */}
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
        </button>
        <button className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <User className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
