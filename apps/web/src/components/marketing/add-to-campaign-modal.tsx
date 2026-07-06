"use client";

/**
 * Bulk-enrol selected contacts/leads into an existing campaign.
 * Used from the Leads and Contacts list bulk-action bars. Leads and contacts
 * are both Person records, so they share the same enrolment endpoint.
 */

import { useEffect, useState } from "react";
import { X, Megaphone, Check } from "lucide-react";
import { api } from "@/lib/api";

interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

interface Props {
  contactIds: string[];
  onClose: () => void;
  onDone?: (count: number) => void;
}

export function AddToCampaignModal({ contactIds, onClose, onDone }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/api/v1/campaigns?limit=100");
        const json = await res.json();
        setCampaigns(json.data ?? []);
      } catch {
        setCampaigns([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const enrol = async (campaignId: string) => {
    setBusy(campaignId);
    setError(null);
    try {
      const res = await api.post(`/api/v1/campaigns/${campaignId}/contacts`, { contactIds });
      if (res.ok) {
        setDone(campaignId);
        onDone?.(contactIds.length);
        setTimeout(onClose, 900);
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "Couldn't add to campaign");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[70vh] w-full max-w-md overflow-auto rounded-2xl border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Megaphone className="h-4 w-4 text-primary" />
            Add {contactIds.length} to a campaign
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns yet — create one first.</p>
        ) : (
          <ul className="space-y-1">
            {campaigns.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => enrol(c.id)}
                  disabled={busy !== null}
                  className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-xs capitalize text-muted-foreground">· {c.status}</span>
                  </span>
                  {done === c.id ? (
                    <Check className="h-4 w-4 shrink-0 text-green-600" />
                  ) : busy === c.id ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Adding…</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
