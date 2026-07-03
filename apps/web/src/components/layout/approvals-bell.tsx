"use client";

/**
 * Top-bar indicator for quotes awaiting the current user's approval.
 * Visible on every page so approvers see pending work without hunting for it.
 * Renders nothing for non-approvers (and stays null on SSR / before mount to
 * avoid hydration mismatches, mirroring how TopNav reads the stored user).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { api } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

const APPROVER_ROLES = ["admin", "manager", "super_admin"];

export function ApprovalsBell() {
  const [count, setCount] = useState(0);
  const [canApprove, setCanApprove] = useState(false);

  useEffect(() => {
    const me = getStoredUser();
    if (!me || !APPROVER_ROLES.includes(me.role)) return;
    setCanApprove(true);

    let alive = true;
    const load = async () => {
      try {
        const res = await api.get("/api/v1/quotes?status=pending_approval");
        const json = await res.json();
        const n = (json.data ?? []).filter(
          (q: { createdBy?: string }) => q.createdBy !== me.id,
        ).length;
        if (alive) setCount(n);
      } catch {
        /* non-fatal — leave count unchanged */
      }
    };
    load();
    const iv = setInterval(load, 60_000); // keep fresh while the app is open
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  if (!canApprove) return null;

  return (
    <Link
      href="/quotes?status=pending_approval"
      title="Quotes awaiting your approval"
      className={cn(
        "relative rounded-md p-2 transition-colors hover:bg-muted",
        count > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <ClipboardCheck className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-yellow-500 px-1 text-[10px] font-bold leading-none text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
