"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { X, User, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  phone?: string;
  seniority?: string;
}

interface Props {
  contact: Contact;
  onClose: () => void;
  onSaved?: (updated: any) => void;
}

const SENIORITY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "individual_contributor", label: "Individual Contributor" },
  { value: "manager",   label: "Manager" },
  { value: "director",  label: "Director" },
  { value: "vp",        label: "VP" },
  { value: "c_suite",   label: "C-Suite" },
  { value: "founder",   label: "Founder" },
];

export function EditContactModal({ contact, onClose, onSaved }: Props) {
  const t = useTranslations("editContact");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    firstName: contact.firstName,
    lastName:  contact.lastName,
    title:     contact.title     ?? "",
    phone:     contact.phone     ?? "",
    seniority: contact.seniority ?? "",
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
      const res = await api.patch(`/api/v1/contacts/${contact.id}`, {
        firstName: form.firstName || undefined,
        lastName:  form.lastName  || undefined,
        title:     form.title     || undefined,
        phone:     form.phone     || undefined,
        seniority: form.seniority || undefined,
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
            <User className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{t("title")}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("firstName")}</label>
              <input value={form.firstName} onChange={set("firstName")} required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("lastName")}</label>
              <input value={form.lastName} onChange={set("lastName")} required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("email")}</label>
            <input value={contact.email} disabled
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground" />
            <p className="mt-1 text-xs text-muted-foreground">{t("emailReadonly")}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{tc("title")}</label>
              <input value={form.title} onChange={set("title")} placeholder="VP Engineering"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("phone")}</label>
              <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+1 555 000 0000"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("seniority")}</label>
            <select value={form.seniority} onChange={set("seniority")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {SENIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.value === "" ? t("selectSeniority") : o.label}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> {t("saved")}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              {tc("cancel")}
            </button>
            <button type="submit" disabled={loading}
              className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                loading ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
              {loading ? tc("saving") : t("saveChanges")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
