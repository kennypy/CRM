"use client";

/**
 * Invite a teammate by email. Creates the user with no password and issues a
 * single-use activation link they use to set their own password on first login
 * (/accept-invite). Since transactional email isn't configured on self-hosted
 * deploys, the activation link is shown here for the admin to share directly.
 */

import { useState } from "react";
import { X, Mail, Copy, Check } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  onClose: () => void;
  onInvited?: () => void;
}

const ROLES = [
  { value: "rep", label: "Rep" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
  { value: "read_only", label: "Read only" },
];

export function InviteUserModal({ onClose, onInvited }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("rep");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post("/api/v1/users/invite", { email, role });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "Couldn't send the invite.");
        return;
      }
      const path = data?.invite?.activationPath as string | undefined;
      setLink(path ? `${window.location.origin}${path}` : null);
      onInvited?.();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked over http — the link is still selectable */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Mail className="h-4 w-4 text-primary" /> Invite a teammate
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        {link ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Invite created. Send this activation link to <span className="font-medium text-foreground">{email}</span> — it lets them set a password and sign in (expires in 7 days).
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
              <input readOnly value={link} className="min-w-0 flex-1 bg-transparent text-xs outline-none" onFocus={(e) => e.currentTarget.select()} />
              <button onClick={copy} className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </button>
            </div>
            <button onClick={onClose} className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</label>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading || !email}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
              {loading ? "Creating invite…" : "Create invite link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
