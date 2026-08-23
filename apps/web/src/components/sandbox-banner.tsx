"use client";

/**
 * Persistent, NON-dismissible banner shown inside sandbox tenants.
 *
 * States plainly that this is a sandbox holding sample data, when it will be
 * wiped, and gives the user a one-click export (GDPR portability / leave with
 * what you created). Driven by tenant state (useTenant), unlike the
 * cookie-driven read-only DemoBanner.
 */

import { useState } from "react";
import { FlaskConical, Download, Loader2 } from "lucide-react";
import { useTenant } from "@/lib/tenant-context";
import { api } from "@/lib/api";

function formatWipeDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function SandboxBanner() {
  const { tenant } = useTenant();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!tenant.isSandbox) return null;

  const wipeDate = formatWipeDate(tenant.sandboxExpiresAt);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await api.post("/api/v1/export", { format: "json" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setExportError(json?.error?.message ?? "Export failed. Try again.");
        return;
      }
      const data = json?.data;
      if (data?.url) {
        // Async job path — a signed download URL.
        window.open(data.url, "_blank", "noopener");
      } else if (data?.jobId) {
        setExportError("Export queued — check back in a minute.");
      } else {
        // Sync path — download the returned JSON directly.
        const blob = new Blob([JSON.stringify(data ?? json, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nexcrm-export-${tenant.slug || "sandbox"}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setExportError("Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      data-testid="sandbox-banner"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-medium text-white"
    >
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Sandbox workspace</strong> — this is sample data for evaluation.
        {wipeDate
          ? ` Everything here will be wiped on ${wipeDate}.`
          : " Everything here is wiped on a schedule."}
      </span>
      <button
        onClick={handleExport}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-white/30 disabled:opacity-60"
      >
        {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Export my data
      </button>
      {exportError && <span className="text-xs text-white/90">{exportError}</span>}
    </div>
  );
}
