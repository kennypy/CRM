"use client";

/**
 * Resolved navigation tab list for the current user.
 *
 * Admins can define tab groups (Settings → Navigation) so e.g. a sales
 * profile only sees Contacts/Companies/Opportunities while marketing sees
 * Campaigns/Leads. `tabs === null` means no grouping is configured for this
 * user — the caller renders the built-in full navigation.
 */

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";

interface NavTabsResult {
  tabs: string[] | null;
  groupName: string | null;
}

// Module-level cache: one fetch per page load, shared across mounts.
let _cache: NavTabsResult | undefined;
let _inflight: Promise<NavTabsResult> | null = null;

async function fetchNavTabs(): Promise<NavTabsResult> {
  if (_cache !== undefined) return _cache;
  if (!_inflight) {
    _inflight = (async () => {
      try {
        const res = await api.get("/api/v1/nav/tabs");
        const json = await res.json().catch(() => null);
        const data = json?.success ? json.data : null;
        _cache = data?.tabs?.length
          ? { tabs: data.tabs as string[], groupName: data.groupName ?? null }
          : { tabs: null, groupName: null };
      } catch {
        _cache = { tabs: null, groupName: null };
      }
      return _cache;
    })();
  }
  return _inflight;
}

/** Invalidate after editing tab groups so the header refreshes on next mount. */
export function invalidateNavTabs(): void {
  _cache = undefined;
  _inflight = null;
}

export function useNavTabs(): NavTabsResult & { ready: boolean } {
  const [state, setState] = useState<NavTabsResult & { ready: boolean }>({
    tabs: null,
    groupName: null,
    ready: _cache !== undefined,
  });

  useEffect(() => {
    let alive = true;
    if (!isAuthenticated()) return;
    fetchNavTabs().then((r) => {
      if (alive) setState({ ...r, ready: true });
    });
    return () => { alive = false; };
  }, []);

  return state;
}
