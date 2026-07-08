"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";

export default function NewWorkspacePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    tenantName: "",
    tenantSlug: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    plan: "starter",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Once the user manually edits the slug we stop auto-deriving it from the name.
  const [slugTouched, setSlugTouched] = useState(false);

  const slugify = (v: string) =>
    v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const update = (key: string, value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      // Keep the slug in sync with the workspace name until the user edits the
      // slug themselves (previously this only fired on the first keystroke, so
      // "Acme Corp" produced the slug "a").
      ...(key === "tenantName" && !slugTouched ? { tenantSlug: slugify(value) } : {}),
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const res = await api.post("/api/admin/tenants", form);
    const json = await res.json();

    if (res.ok) {
      router.push(`/admin/workspaces/${json.data.id}`);
    } else {
      setError(json.error?.message ?? "Failed to create workspace");
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/workspaces"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold">New Workspace</h1>
      </div>

      <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-6 space-y-5">
        <h2 className="font-semibold border-b pb-3">Workspace Details</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Workspace Name *</label>
            <input
              type="text"
              required
              value={form.tenantName}
              onChange={(e) => update("tenantName", e.target.value)}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Slug *</label>
            <input
              type="text"
              required
              pattern="[a-z0-9-]+"
              value={form.tenantSlug}
              onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, tenantSlug: slugify(e.target.value) })); }}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="acme-corp"
            />
            <p className="mt-1 text-xs text-muted-foreground">Lowercase letters, numbers, hyphens only</p>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Plan</label>
          <select
            value={form.plan}
            onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>

        <h2 className="font-semibold border-b pb-3 pt-2">Initial Admin User</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">First Name *</label>
            <input
              type="text"
              required
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Last Name *</label>
            <input
              type="text"
              required
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Email *</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Password *</label>
          <input
            type="password"
            required
            minLength={12}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Min 12 chars, must include uppercase, lowercase, number, and special character
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create Workspace"}
        </button>
      </form>
    </div>
  );
}
