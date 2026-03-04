"use client";

import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import { X, User, AlertCircle, CheckCircle2, Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MatchedCompany {
  id: string;
  name: string;
  domain: string;
}

interface Props {
  onClose: () => void;
  onCreated?: (contact: any) => void;
  /** Pre-link to a specific company (from account detail page) */
  prelinkedCompanyId?: string;
  prelinkedCompanyName?: string;
}

export function AddContactModal({ onClose, onCreated, prelinkedCompanyId, prelinkedCompanyName }: Props) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", title: "", phone: "",
    linkedinUrl: "", notes: "",
  });
  const [matchedCompany, setMatchedCompany] = useState<MatchedCompany | null>(
    prelinkedCompanyId ? { id: prelinkedCompanyId, name: prelinkedCompanyName ?? "", domain: "" } : null
  );
  const [domainLookupPending, setDomainLookupPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const SKIP_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com"]);

  const handleEmailBlur = useCallback(async () => {
    if (prelinkedCompanyId) return; // already linked
    const email = form.email.trim();
    const atIdx = email.indexOf("@");
    if (atIdx === -1) return;
    const domain = email.slice(atIdx + 1).toLowerCase();
    if (!domain || SKIP_DOMAINS.has(domain)) return;

    setDomainLookupPending(true);
    try {
      const res = await api.get(`/api/v1/companies/by-domain/${encodeURIComponent(domain)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.data) setMatchedCompany(data.data);
      } else {
        setMatchedCompany(null);
      }
    } catch {
      // Non-fatal: just don't auto-link
    } finally {
      setDomainLookupPending(false);
    }
  }, [form.email, prelinkedCompanyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post("/api/v1/contacts", {
        firstName:   form.firstName,
        lastName:    form.lastName,
        email:       form.email,
        title:       form.title        || undefined,
        phone:       form.phone        || undefined,
        linkedinUrl: form.linkedinUrl  || undefined,
        notes:       form.notes        || undefined,
        companyId:   matchedCompany?.id || undefined,
        source: "user",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? "Failed to create contact");
        return;
      }
      const data = await res.json();
      setDone(true);
      onCreated?.(data.data);
      setTimeout(onClose, 1200);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Add Contact</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">First name *</label>
              <input value={form.firstName} onChange={set("firstName")} required placeholder="Ada"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Last name *</label>
              <input value={form.lastName} onChange={set("lastName")} required placeholder="Lovelace"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Email *</label>
            <div className="relative">
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                onBlur={handleEmailBlur}
                required
                placeholder="ada@company.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 pr-8"
              />
              {domainLookupPending && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {/* Domain auto-match indicator */}
            {matchedCompany && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-700">
                <Building2 className="h-3.5 w-3.5" />
                <span>
                  Matched: <strong>{matchedCompany.name}</strong> — contact will be linked automatically
                </span>
                {!prelinkedCompanyId && (
                  <button
                    type="button"
                    onClick={() => setMatchedCompany(null)}
                    className="ml-auto text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Title</label>
              <input value={form.title} onChange={set("title")} placeholder="VP Engineering"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Phone</label>
              <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+1 555 000 0000"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">LinkedIn URL</label>
            <input value={form.linkedinUrl} onChange={set("linkedinUrl")} placeholder="linkedin.com/in/ada"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Notes</label>
            <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Any context to add…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Contact created!
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
              {loading ? "Creating…" : "Create Contact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
