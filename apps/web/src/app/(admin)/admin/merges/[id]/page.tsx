"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { MergeConflictRow } from "@/components/admin/merge-conflict-row";

interface ConflictRecord {
  id: string;
  label: string;
  fields: Record<string, unknown>;
}

interface MergeConflict {
  entityType: string;
  sourceRecord: ConflictRecord;
  targetRecord: ConflictRecord;
  matchKey: string;
  conflictingFields: string[];
}

type Resolution = {
  entityType: string;
  matchKey: string;
  action: "keep_source" | "keep_target" | "merge_fields";
  fieldOverrides?: Record<string, "source" | "target">;
};

interface MergeData {
  id: string;
  sourceId: string;
  targetId: string;
  sourceName: string;
  sourceSlug: string;
  targetName: string;
  targetSlug: string;
  status: string;
  conflicts: MergeConflict[];
  stats: {
    users: { source: number; target: number; conflicts: number };
    contacts: { source: number; target: number; conflicts: number };
    companies: { source: number; target: number; conflicts: number };
    deals: { source: number; target: number };
    sequences: { source: number; target: number; conflicts: number };
    customObjects: { source: number; target: number; conflicts: number };
  } | null;
  resolutions: Resolution[];
  summary?: { moved: number; merged: number; skipped: number };
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export default function MergeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [merge, setMerge] = useState<MergeData | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    api.get(`/api/admin/merges/${id}`).then(async (res) => {
      if (res.ok) {
        const json = await res.json();
        setMerge(json.data);
        // Pre-load existing resolutions
        if (json.data.resolutions?.length) {
          const map = new Map<string, Resolution>();
          for (const r of json.data.resolutions) {
            map.set(`${r.entityType}:${r.matchKey}`, r);
          }
          setResolutions(map);
        }
      }
      setLoading(false);
    });
  }, [id]);

  const handleResolve = (res: Resolution) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(`${res.entityType}:${res.matchKey}`, res);
      return next;
    });
  };

  const allResolved = merge?.conflicts.every(
    (c) => resolutions.has(`${c.entityType}:${c.matchKey}`)
  );

  const submitResolutions = async () => {
    const items = Array.from(resolutions.values());
    const res = await api.patch(`/api/admin/merges/${id}`, { resolutions: items });
    if (res.ok) {
      const json = await res.json();
      setMerge(json.data);
    }
  };

  const executeMerge = async () => {
    setExecuting(true);
    // Save resolutions first if not already approved
    if (merge?.status === "pending") {
      await submitResolutions();
    }
    const res = await api.post(`/api/admin/merges/${id}/execute`, {});
    if (res.ok) {
      const json = await res.json();
      setMerge(json.data);
    }
    setExecuting(false);
  };

  const cancelMerge = async () => {
    setCancelling(true);
    const res = await api.post(`/api/admin/merges/${id}/cancel`, {});
    if (res.ok) {
      const json = await res.json();
      setMerge(json.data);
    }
    setCancelling(false);
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl text-sm text-muted-foreground">Loading...</div>;
  }

  if (!merge) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-muted-foreground">Merge not found.</p>
      </div>
    );
  }

  const isTerminal = ["completed", "failed", "cancelled"].includes(merge.status);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/workspaces"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Merge Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            {merge.sourceName} ({merge.sourceSlug}) → {merge.targetName} ({merge.targetSlug})
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
          merge.status === "completed" ? "bg-green-100 text-green-700" :
          merge.status === "failed" ? "bg-red-100 text-red-700" :
          merge.status === "cancelled" ? "bg-gray-100 text-gray-700" :
          merge.status === "in_progress" ? "bg-blue-100 text-blue-700" :
          "bg-amber-100 text-amber-700"
        }`}>
          {merge.status.replace("_", " ")}
        </span>
      </div>

      {/* Summary stats */}
      {merge.stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(merge.stats).map(([key, val]) => (
            <div key={key} className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1")}</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-lg font-bold">
                  {"conflicts" in val ? val.conflicts : 0}
                </span>
                <span className="text-xs text-muted-foreground">
                  conflicts / {"source" in val ? val.source : 0} + {"target" in val ? val.target : 0} records
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed summary */}
      {merge.status === "completed" && merge.summary && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            <h2 className="font-semibold text-green-800">Merge Completed</h2>
          </div>
          <p className="text-sm text-green-700">
            {merge.summary.moved} records moved, {merge.summary.merged} records merged, {merge.summary.skipped} skipped.
          </p>
        </div>
      )}

      {/* Failed */}
      {merge.status === "failed" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <X className="h-5 w-5 text-red-600" />
            <h2 className="font-semibold text-red-800">Merge Failed</h2>
          </div>
          <p className="text-sm text-red-700">{merge.errorMessage}</p>
        </div>
      )}

      {/* Conflicts */}
      {!isTerminal && merge.conflicts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="font-semibold">
              {merge.conflicts.length} Conflict{merge.conflicts.length !== 1 ? "s" : ""} to Resolve
            </h2>
          </div>

          {merge.conflicts.map((conflict) => (
            <MergeConflictRow
              key={`${conflict.entityType}:${conflict.matchKey}`}
              conflict={conflict}
              resolution={resolutions.get(`${conflict.entityType}:${conflict.matchKey}`)}
              onResolve={handleResolve}
              sourceName={merge.sourceName}
              targetName={merge.targetName}
            />
          ))}
        </div>
      )}

      {!isTerminal && merge.conflicts.length === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            <p className="text-sm font-medium text-green-800">No conflicts found! You can execute the merge directly.</p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!isTerminal && (
        <div className="flex items-center gap-3 pt-2 border-t">
          <button
            onClick={executeMerge}
            disabled={executing || (merge.conflicts.length > 0 && !allResolved)}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {executing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                {merge.conflicts.length > 0 && !allResolved
                  ? `Resolve all conflicts first (${resolutions.size}/${merge.conflicts.length})`
                  : "Execute Merge"}
              </>
            )}
          </button>
          <button
            onClick={cancelMerge}
            disabled={cancelling}
            className="rounded-lg border px-5 py-2.5 text-sm font-medium hover:bg-muted"
          >
            {cancelling ? "Cancelling..." : "Cancel Merge"}
          </button>
        </div>
      )}
    </div>
  );
}
