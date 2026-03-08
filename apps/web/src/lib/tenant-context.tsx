"use client";

/**
 * TenantContext — loads tenant preferences once at app boot.
 *
 * Provides:
 *   - useTenant()  → { tenant, loading, refresh }
 *
 * TenantId is sourced exclusively from the JWT verified by the API gateway;
 * the frontend never passes tenantId as a query param to /api/v1/tenant.
 *
 * Safety: load() checks for a stored token before calling the API so that
 * the TenantProvider mounted on the /login page does NOT trigger a 401
 * redirect loop.  The login page calls refresh() after a successful login.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { api } from "./api";
import { isAuthenticated } from "./auth";

export interface TenantPreferences {
  id:              string;
  name:            string;
  slug:            string;
  plan:            string;
  /** ISO 4217 — e.g. "EUR", "USD", "GBP" */
  defaultCurrency: string;
  /** BCP-47 — e.g. "de-DE", "en-US" */
  locale:          string;
  /** IANA timezone — e.g. "Europe/Berlin" */
  timezone:        string;
}

const DEFAULT_TENANT: TenantPreferences = {
  id:              "",
  name:            "",
  slug:            "",
  plan:            "starter",
  defaultCurrency: "USD",
  locale:          "en-US",
  timezone:        "UTC",
};

interface TenantContextValue {
  tenant:  TenantPreferences;
  loading: boolean;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue>({
  tenant:  DEFAULT_TENANT,
  loading: false,
  refresh: async () => {},
});

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant,  setTenant]  = useState<TenantPreferences>(DEFAULT_TENANT);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    // Do not call the API unless the user is authenticated — avoids a 401
    // redirect loop when TenantProvider is mounted on the /login page.
    if (!isAuthenticated()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await api.get("/api/v1/tenant");
      if (res.ok) {
        const json = await res.json();
        if (json.data) setTenant(json.data as TenantPreferences);
      }
    } catch {
      // Non-fatal — fall back to defaults (USD / en-US / UTC)
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <TenantContext.Provider value={{ tenant, loading, refresh: load }}>
      {children}
    </TenantContext.Provider>
  );
}

/** Returns tenant preferences. Falls back to USD / en-US while loading. */
export function useTenant() {
  return useContext(TenantContext);
}
