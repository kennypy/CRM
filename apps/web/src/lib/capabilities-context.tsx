"use client";

/**
 * Instance capability manifest — which product capabilities this DEPLOYMENT
 * has (distinct from per-user permission capabilities in permissions.ts).
 *
 * Fetched once from GET /api/v1/capabilities after login. The demo stack
 * omits ingestion / ai-engine / minio and its workers, and the UI must hide
 * or visibly disable the features they back rather than render them and fail
 * at runtime.
 *
 * Defaults to everything-enabled while loading (and on full-stack deploys the
 * fetch confirms that), so a transient fetch failure never hides features on
 * a full instance.
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

export interface InstanceCapabilities {
  /** Email/calendar auto-capture + integration sync (ingestion service). */
  activity_ingestion: boolean;
  /** AI features backed by ai-engine (forecast AI, lead scoring, anomalies).
   *  NOTE: Reality Score is deterministic and served by graph-core — it is
   *  NOT gated by this flag. */
  ai_scoring: boolean;
  /** File storage (minio). */
  file_attachments: boolean;
  /** Semantic search (pgvector population by the absent workers). */
  semantic_search: boolean;
}

const ALL_ENABLED: InstanceCapabilities = {
  activity_ingestion: true,
  ai_scoring: true,
  file_attachments: true,
  semantic_search: true,
};

interface CapabilitiesContextValue {
  capabilities: InstanceCapabilities;
  loading: boolean;
}

const CapabilitiesContext = createContext<CapabilitiesContextValue>({
  capabilities: ALL_ENABLED,
  loading: false,
});

export function CapabilityProvider({ children }: { children: React.ReactNode }) {
  const [capabilities, setCapabilities] = useState<InstanceCapabilities>(ALL_ENABLED);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthenticated()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get("/api/v1/capabilities");
      if (res.ok) {
        const json = await res.json();
        if (json.data) setCapabilities({ ...ALL_ENABLED, ...json.data });
      }
    } catch {
      // Non-fatal — keep the all-enabled default.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <CapabilitiesContext.Provider value={{ capabilities, loading }}>
      {children}
    </CapabilitiesContext.Provider>
  );
}

/** The deployment's capability manifest. All-enabled while loading. */
export function useInstanceCapabilities() {
  return useContext(CapabilitiesContext);
}
