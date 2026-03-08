"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MergeContactsModal } from "@/components/contacts/merge-contacts-modal";
import {
  AlertCircle, RefreshCw, Users, Building2, Check, X, Search,
} from "lucide-react";

interface DuplicatePair {
  id1: string;
  id2: string;
  name1: string;
  name2: string;
  email1: string;
  email2: string;
  confidence: number;
  reason: string;
}

export default function DedupPage() {
  const tc = useTranslations("common");
  const [entityType, setEntityType] = useState<"contact" | "company">("contact");
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<DuplicatePair | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/v1/admin/duplicates?entity_type=${entityType}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setPairs(json.data ?? []);
      setScanned(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  const dismiss = async (pair: DuplicatePair) => {
    const key = [pair.id1, pair.id2].sort().join(":");
    setDismissed((prev) => new Set(prev).add(key));
    await api.post("/api/v1/admin/duplicates/dismiss", {
      id1: pair.id1,
      id2: pair.id2,
      entity_type: entityType,
    }).catch(() => {});
  };

  const visiblePairs = pairs.filter((p) => {
    const key = [p.id1, p.id2].sort().join(":");
    return !dismissed.has(key);
  });

  const confidenceColor = (c: number) =>
    c >= 80 ? "text-red-600 bg-red-50" : c >= 60 ? "text-orange-600 bg-orange-50" : "text-yellow-600 bg-yellow-50";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Data Deduplication</h1>
          <p className="text-sm text-muted-foreground">
            Find and merge duplicate records across your CRM
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="flex rounded-lg border">
          <button
            onClick={() => { setEntityType("contact"); setScanned(false); setPairs([]); }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium",
              entityType === "contact" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            <Users className="h-4 w-4" /> Contacts
          </button>
          <button
            onClick={() => { setEntityType("company"); setScanned(false); setPairs([]); }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium",
              entityType === "company" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            <Building2 className="h-4 w-4" /> Companies
          </button>
        </div>

        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          <Search className="h-4 w-4" />
          {loading ? "Scanning…" : "Scan for Duplicates"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {scanned && !loading && visiblePairs.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16">
          <Check className="h-8 w-8 text-green-500" />
          <p className="text-sm font-medium">No duplicates found</p>
          <p className="text-xs text-muted-foreground">Your {entityType} records look clean!</p>
        </div>
      )}

      {visiblePairs.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Found {visiblePairs.length} potential duplicate{visiblePairs.length !== 1 ? "s" : ""}
          </p>

          {visiblePairs.map((pair) => {
            const key = [pair.id1, pair.id2].sort().join(":");
            return (
              <div key={key} className="flex items-center gap-4 rounded-xl border bg-card p-4">
                {/* Record 1 */}
                <div className="flex-1">
                  <p className="text-sm font-medium">{pair.name1}</p>
                  <p className="text-xs text-muted-foreground">{pair.email1}</p>
                </div>

                {/* Confidence badge */}
                <div className="flex flex-col items-center gap-1">
                  <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", confidenceColor(pair.confidence))}>
                    {pair.confidence}% match
                  </span>
                  <span className="text-[10px] text-muted-foreground">{pair.reason}</span>
                </div>

                {/* Record 2 */}
                <div className="flex-1 text-right">
                  <p className="text-sm font-medium">{pair.name2}</p>
                  <p className="text-xs text-muted-foreground">{pair.email2}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {entityType === "contact" && (
                    <button
                      onClick={() => setMergeTarget(pair)}
                      className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      <RefreshCw className="h-3 w-3" /> Merge
                    </button>
                  )}
                  <button
                    onClick={() => dismiss(pair)}
                    className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <X className="h-3 w-3" /> Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mergeTarget && (
        <MergeContactsModal
          contacts={[
            { id: mergeTarget.id1, firstName: mergeTarget.name1.split(" ")[0] ?? "", lastName: mergeTarget.name1.split(" ").slice(1).join(" "), email: mergeTarget.email1 },
            { id: mergeTarget.id2, firstName: mergeTarget.name2.split(" ")[0] ?? "", lastName: mergeTarget.name2.split(" ").slice(1).join(" "), email: mergeTarget.email2 },
          ]}
          onClose={() => setMergeTarget(null)}
          onMerged={() => { setMergeTarget(null); scan(); }}
        />
      )}
    </div>
  );
}
