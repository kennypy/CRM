"use client";

import { useState, useEffect, useRef } from "react";
import { User, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface OwnerPickerProps {
  value?: string | null;
  onChange: (userId: string | null) => void;
  compact?: boolean;
  className?: string;
}

export function OwnerPicker({ value, onChange, compact, className }: OwnerPickerProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get("/api/v1/users").then(async (res) => {
      if (res.ok) {
        const json = await res.json();
        setUsers(json.data ?? json.users ?? []);
      }
    });
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = users.find((u) => u.id === value);
  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.firstName.toLowerCase().includes(q) ||
      u.lastName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  const initials = (u: UserOption) =>
    `${u.firstName?.[0] ?? ""}${u.lastName?.[0] ?? ""}`.toUpperCase();

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-2 py-1 text-sm transition-colors hover:bg-muted",
          compact && "px-1.5 py-0.5 text-xs",
        )}
      >
        {selected ? (
          <>
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {initials(selected)}
            </div>
            <span className="max-w-[120px] truncate">{selected.firstName} {selected.lastName}</span>
          </>
        ) : (
          <>
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Unassigned</span>
          </>
        )}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border bg-card py-1 shadow-lg">
          <div className="px-2 pb-1">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users…"
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/30"
              autoFocus
            />
          </div>
          {value && (
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <X className="h-3 w-3" /> Clear assignment
            </button>
          )}
          <div className="max-h-48 overflow-auto">
            {filtered.map((u) => (
              <button
                key={u.id}
                onClick={() => { onChange(u.id); setOpen(false); setSearch(""); }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted",
                  value === u.id && "bg-primary/5 text-primary",
                )}
              >
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {initials(u)}
                </div>
                <span className="truncate">{u.firstName} {u.lastName}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No users found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
