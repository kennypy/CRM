"use client";

/**
 * "Awaiting your approval" inbox for the home dashboard.
 *
 * Surfaces quotes in `pending_approval` that the current user can act on
 * (excludes ones they created — separation of duties). Self-gates: renders
 * nothing for non-approvers or when the queue is empty, so it only appears
 * when there's something for *you* to do.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Check } from "lucide-react";
import { api } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";

interface PendingQuote {
  id: string;
  title: string;
  total: number;
  currency: string;
  companyName?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
}

const APPROVER_ROLES = ["admin", "manager", "super_admin"];

export function ApprovalsInbox() {
  const me = getStoredUser();
  const canApprove = APPROVER_ROLES.includes(me?.role ?? "");

  const [items, setItems] = useState<PendingQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/v1/quotes?status=pending_approval");
      const json = await res.json();
      const all: PendingQuote[] = json.data ?? [];
      // Approvals waiting on *you*: you can't approve your own quote.
      setItems(all.filter((q) => q.createdBy !== me?.id));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [me?.id]);

  useEffect(() => {
    if (canApprove) load();
    else setLoading(false);
  }, [canApprove, load]);

  const approve = async (id: string) => {
    setBusy(id);
    try {
      const res = await api.post(`/api/v1/quotes/${id}/approve`, {});
      if (res.ok) setItems((prev) => prev.filter((q) => q.id !== id));
    } finally {
      setBusy(null);
    }
  };

  // Only show when there's something for this user to act on.
  if (!canApprove || loading || items.length === 0) return null;

  return (
    <div className="rounded-xl border border-yellow-400/50 bg-yellow-50 p-4 dark:border-yellow-500/30 dark:bg-yellow-500/10">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
        <h2 className="font-semibold">
          Awaiting your approval{" "}
          <span className="font-normal text-muted-foreground">({items.length})</span>
        </h2>
        <Link
          href="/quotes?status=pending_approval"
          className="ml-auto text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      <ul className="divide-y divide-yellow-400/30">
        {items.slice(0, 5).map((q) => (
          <li key={q.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <Link href="/quotes?status=pending_approval" className="truncate font-medium hover:underline">
                {q.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {q.companyName ? `${q.companyName} · ` : ""}
                {formatCurrency(q.total, q.currency)}
                {q.createdByName ? ` · by ${q.createdByName}` : ""}
              </p>
            </div>
            <button
              onClick={() => approve(q.id)}
              disabled={busy === q.id}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> {busy === q.id ? "Approving…" : "Approve"}
            </button>
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <Link
          href="/quotes?status=pending_approval"
          className="mt-2 block text-center text-sm text-primary hover:underline"
        >
          + {items.length - 5} more
        </Link>
      )}
    </div>
  );
}
