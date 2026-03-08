"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X, AlertCircle, Merge, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface ContactSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: { id: string; name: string };
}

interface MergeContactsModalProps {
  contacts: ContactSummary[];
  onClose: () => void;
  onMerged: () => void;
}

export function MergeContactsModal({ contacts, onClose, onMerged }: MergeContactsModalProps) {
  const tc = useTranslations("common");
  const [primaryId, setPrimaryId] = useState(contacts[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleMerge = async () => {
    setLoading(true);
    setError(null);
    try {
      const secondaryIds = contacts.filter((c) => c.id !== primaryId).map((c) => c.id);
      const res = await api.post("/api/v1/contacts/merge", { primaryId, secondaryIds });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Merge failed");
        return;
      }
      setDone(true);
      setTimeout(() => { onMerged(); onClose(); }, 1000);
    } catch {
      setError(tc("networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Merge className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Merge Contacts</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Select the primary record. All activities, notes, and relationships from the other records will be merged into it.
          </p>

          <div className="space-y-2">
            {contacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setPrimaryId(c.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all",
                  primaryId === c.id ? "border-primary bg-primary/5" : "hover:bg-muted",
                )}
              >
                <div className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border",
                  primaryId === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}>
                  {primaryId === c.id && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{c.firstName} {c.lastName}</p>
                  <p className="text-xs text-muted-foreground">{c.email}</p>
                </div>
                {primaryId === c.id && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Primary</span>
                )}
              </button>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <Check className="h-4 w-4" /> Contacts merged successfully!
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              className="flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              {tc("cancel")}
            </button>
            <button onClick={handleMerge} disabled={loading || done || contacts.length < 2}
              className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                (loading || done) ? "opacity-60" : "hover:opacity-90")}>
              {loading ? "Merging…" : "Merge Contacts"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
