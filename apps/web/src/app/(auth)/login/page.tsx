"use client";

import { Suspense, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { setAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant-context";
import { Eye, EyeOff, Zap, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { refresh }  = useTenant();

  // Validate the ?next= param is a safe relative path (prevents open redirect CWE-601)
  const rawNext = searchParams.get("next") ?? "/";
  const decoded = decodeURIComponent(rawNext);
  const next = (
    decoded.startsWith("/") &&
    !decoded.startsWith("//") &&
    !decoded.includes("://") &&
    !decoded.startsWith("/login") &&
    !decoded.startsWith("/register")
  ) ? decoded : "/";

  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm]       = useState({ tenantSlug: "", email: "", password: "" });
  const [showPw, setShowPw]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Read DOM values as fallback for browser autofill (autofill doesn't fire onChange)
    const fd = formRef.current ? new FormData(formRef.current) : null;
    const tenantSlug = form.tenantSlug || (fd?.get("tenantSlug") as string) || "";
    const email = form.email || (fd?.get("email") as string) || "";
    const password = form.password || (fd?.get("password") as string) || "";

    try {
      const res = await api.public.post("/api/auth/login", {
        tenantSlug,
        email,
        password,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data?.error?.message ?? data?.error) ?? "Invalid credentials");
        return;
      }

      const data = await res.json();
      const { user, tenant } = data.data ?? data;

      setAuth("", "", {
        id:         user.id,
        email:      user.email,
        firstName:  user.firstName,
        lastName:   user.lastName,
        role:       user.role,
        tenantId:   user.tenantId,
        tenantName: tenant?.name ?? form.tenantSlug,
      });

      // Load tenant preferences now that we're authenticated
      await refresh();

      router.replace(next);
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" suppressHydrationWarning>
      {/* Workspace */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">Workspace</label>
        <div className="flex items-center rounded-lg border border-border overflow-hidden focus-within:ring-2 focus-within:ring-primary/30">
          <span className="border-r bg-muted px-3 py-2 text-sm text-muted-foreground select-none">
            nexcrm.app /
          </span>
          <input
            type="text"
            name="tenantSlug"
            autoComplete="organization"
            placeholder="your-team"
            value={form.tenantSlug}
            onChange={(e) => setForm((f) => ({ ...f, tenantSlug: e.target.value }))}
            required
            suppressHydrationWarning
            className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Email */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">Email</label>
        <input
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
          suppressHydrationWarning
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Password */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-sm font-medium">Password</label>
          <button type="button" className="text-xs text-primary hover:underline" tabIndex={-1}
            onClick={() => alert("Contact your workspace admin to reset your password, or email support@nexcrm.dev")}>
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
            suppressHydrationWarning
            className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        suppressHydrationWarning
        className={cn(
          "w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity",
          loading ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"
        )}
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border bg-card p-8 shadow-xl">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">NexCRM</h1>
          <p className="text-sm text-muted-foreground">AI-Native Revenue OS</p>
        </div>

        <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have a workspace?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create one free
          </Link>
        </p>
      </div>
    </div>
  );
}
