"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { setAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant-context";
import { Zap, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useTenant();
  const [form, setForm] = useState({
    orgName: "", tenantSlug: "", firstName: "", lastName: "", email: "", password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Auto-generate slug from org name
  const handleOrgChange = (v: string) => {
    const slug = v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    setForm((f) => ({ ...f, orgName: v, tenantSlug: slug }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.public.post("/api/auth/register", {
        tenantName: form.orgName,
        tenantSlug: form.tenantSlug,
        firstName:  form.firstName,
        lastName:   form.lastName,
        email:      form.email,
        password:   form.password,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data?.error?.message ?? data?.error) ?? "Registration failed");
        return;
      }

      const data = await res.json();
      const { user, tenant } = data.data ?? data;
      setAuth("", "", {
        id: user.id, email: user.email,
        firstName: user.firstName, lastName: user.lastName,
        role: user.role, tenantId: user.tenantId, tenantName: tenant?.name ?? form.orgName,
      });
      await refresh();
      router.replace("/");
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const field = (
    label: string,
    name: keyof typeof form,
    type = "text",
    placeholder = ""
  ) => (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={form[name]}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
        required
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Create your workspace</h1>
          <p className="text-sm text-muted-foreground">Free 14-day trial, no credit card</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Organisation name</label>
            <input
              type="text"
              placeholder="Acme Corp"
              value={form.orgName}
              onChange={(e) => handleOrgChange(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Workspace URL</label>
            <div className="flex items-center rounded-lg border border-border overflow-hidden focus-within:ring-2 focus-within:ring-primary/30">
              <span className="border-r bg-muted px-3 py-2 text-sm text-muted-foreground select-none">nexcrm.app /</span>
              <input
                type="text"
                value={form.tenantSlug}
                onChange={(e) => setForm((f) => ({ ...f, tenantSlug: e.target.value }))}
                required
                className="flex-1 bg-transparent px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("First name", "firstName", "text", "Ada")}
            {field("Last name",  "lastName",  "text", "Lovelace")}
          </div>
          {field("Work email", "email",    "email",    "ada@acme.com")}
          {field("Password",   "password", "password", "••••••••")}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity",
              loading ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"
            )}
          >
            {loading ? "Creating workspace…" : "Create workspace"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have a workspace?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
