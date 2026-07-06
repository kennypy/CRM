"use client";

/**
 * Enrol existing contacts (or leads — both are Person records) into a campaign.
 * The enrolment endpoint already existed; this is the missing UI. Shows the live
 * enrolled count and a search-to-add picker.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, UserPlus, Check, Users } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  campaignId: string;
  onEnrolledChange?: (total: number) => void;
}

interface ContactHit {
  id: string;
  name: string;
  email: string;
}

export function CampaignContacts({ campaignId, onEnrolledChange }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<ContactHit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadEnrolled = useCallback(async () => {
    try {
      const res = await api.get(`/api/v1/campaigns/${campaignId}/contacts`);
      const json = await res.json();
      const rows: { contact_id: string }[] = json.data ?? [];
      setCount(rows.length);
      setEnrolledIds(new Set(rows.map((r) => r.contact_id)));
    } catch {
      setCount(null);
    }
  }, [campaignId]);

  useEffect(() => {
    loadEnrolled();
  }, [loadEnrolled]);

  const runSearch = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/api/v1/contacts?search=${encodeURIComponent(q)}&limit=8`);
        const json = await res.json();
        setResults(
          (json.data ?? []).map((c: Record<string, unknown>) => ({
            id: String(c.id),
            name: String(c.fullName ?? `${c.firstName ?? ""} ${c.lastName ?? ""}`).trim() || "(no name)",
            email: String(c.email ?? ""),
          })),
        );
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const enrol = async (c: ContactHit) => {
    if (enrolledIds.has(c.id)) return;
    try {
      const res = await api.post(`/api/v1/campaigns/${campaignId}/contacts`, { contactIds: [c.id] });
      if (res.ok) {
        setEnrolledIds((prev) => new Set(prev).add(c.id));
        setAdded((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
        const next = (count ?? 0) + 1;
        setCount(next);
        onEnrolledChange?.(next);
        setQuery("");
        setResults([]);
      }
    } catch {
      /* non-fatal */
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">
          Contacts &amp; leads{count != null && <span className="ml-1 font-normal text-muted-foreground">({count} enrolled)</span>}
        </h3>
      </div>

      {/* Search-to-add */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search contacts or leads to add…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {query.trim() && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
            {searching && <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>}
            {!searching && results.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>
            )}
            {results.map((c) => {
              const isIn = enrolledIds.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => enrol(c)}
                  disabled={isIn}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{c.name}</span>
                    {c.email && <span className="ml-2 text-muted-foreground">{c.email}</span>}
                  </span>
                  {isIn ? (
                    <span className="flex items-center gap-1 text-xs text-green-600"><Check className="h-3.5 w-3.5" /> Added</span>
                  ) : (
                    <UserPlus className="h-4 w-4 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Recently added this session */}
      {added.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {added.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-700 dark:bg-green-500/15 dark:text-green-400">
              <Check className="h-3 w-3" /> {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
