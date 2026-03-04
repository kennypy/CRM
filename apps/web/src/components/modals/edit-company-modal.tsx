"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { X, Building2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Company {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  headcount?: number;
  tier?: string;
  country?: string;
  website?: string;
}

interface Props {
  company: Company;
  onClose: () => void;
  onSaved?: (updated: any) => void;
}

const TIER_OPTIONS = [
  { value: "",            label: "— select —" },
  { value: "smb",         label: "SMB" },
  { value: "mid_market",  label: "Mid-Market" },
  { value: "enterprise",  label: "Enterprise" },
];

export function EditCompanyModal({ company, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name:      company.name,
    industry:  company.industry  ?? "",
    headcount: company.headcount?.toString() ?? "",
    tier:      company.tier      ?? "",
    country:   company.country   ?? "",
    website:   company.website   ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.patch(`/api/v1/companies/${company.id}`, {
        name:      form.name      || undefined,
        industry:  form.industry  || undefined,
        headcount: form.headcount ? parseInt(form.headcount, 10) : undefined,
        tier:      form.tier      || undefined,
        country:   form.country   || undefined,
        website:   form.website   || undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? "Failed to save");
        return;
      }
      const data = await res.json();
      setDone(true);
      onSaved?.(data.data);
      setTimeout(onClose, 1000);
    } catch {
      setError("Network error — please try again");
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
            <Building2 className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Edit Company</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Company name</label>
            <input value={form.name} onChange={set("name")} required
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Domain</label>
            <input value={company.domain ?? ""} disabled
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground" />
            <p className="mt-1 text-xs text-muted-foreground">Domain cannot be changed</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Industry</label>
              <input value={form.industry} onChange={set("industry")} placeholder="SaaS"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Employees</label>
              <input type="number" min="1" value={form.headcount} onChange={set("headcount")} placeholder="250"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Tier</label>
              <select value={form.tier} onChange={set("tier")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                {TIER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Country</label>
              <input value={form.country} onChange={set("country")} placeholder="Germany"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Website</label>
            <input value={form.website} onChange={set("website")} placeholder="https://example.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Saved!
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                loading ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
              {loading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
