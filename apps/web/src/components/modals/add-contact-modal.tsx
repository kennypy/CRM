"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { X, User, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onClose: () => void;
  onCreated?: (contact: any) => void;
}

export function AddContactModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", title: "", phone: "", company: "",
    linkedinUrl: "", notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post("/api/v1/contacts", {
        firstName:   form.firstName,
        lastName:    form.lastName,
        email:       form.email,
        title:       form.title   || undefined,
        phone:       form.phone   || undefined,
        linkedinUrl: form.linkedinUrl || undefined,
        notes:       form.notes   || undefined,
        companyName: form.company || undefined,
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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Add Contact</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
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
            <input type="email" value={form.email} onChange={set("email")} required placeholder="ada@company.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Title</label>
              <input value={form.title} onChange={set("title")} placeholder="VP Engineering"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Company</label>
              <input value={form.company} onChange={set("company")} placeholder="Acme Corp"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Phone</label>
              <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+1 555 000 0000"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">LinkedIn URL</label>
              <input value={form.linkedinUrl} onChange={set("linkedinUrl")} placeholder="linkedin.com/in/ada"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
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
