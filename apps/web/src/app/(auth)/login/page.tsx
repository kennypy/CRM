"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { setAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant-context";
import { Eye, EyeOff, Zap, AlertCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { refresh }  = useTenant();
  const t = useTranslations("auth");

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
  const [ssoOkta, setSsoOkta] = useState(false);

  // Surface an SSO error passed back via ?error= after a failed Okta round-trip.
  const ssoError = searchParams.get("error");

  // Only show the Okta button when the deployment has it configured.
  useEffect(() => {
    fetch("/api/auth/sso-config")
      .then((r) => r.json())
      .then((d) => setSsoOkta(Boolean(d?.okta)))
      .catch(() => setSsoOkta(false));
  }, []);

  const startOkta = () => {
    const params = new URLSearchParams();
    if (form.tenantSlug) params.set("tenant", form.tenantSlug);
    params.set("next", next);
    window.location.href = `/api/auth/sso/okta/start?${params.toString()}`;
  };

  const SSO_ERRORS: Record<string, string> = {
    sso_unavailable: "Single sign-on isn't configured for this deployment.",
    sso_no_workspace: "No workspace matches your account. Enter your workspace name and try again.",
    sso_email_unverified: "Your identity provider hasn't verified your email.",
    sso_denied: "Sign-in was cancelled.",
  };

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
        setError((data?.error?.message ?? data?.error) ?? t("invalidCredentials"));
        return;
      }

      const data = await res.json();
      const { user, tenant } = data.data ?? data;

      setAuth("", "", {
        id:            user.id,
        email:         user.email,
        firstName:     user.firstName,
        lastName:      user.lastName,
        role:          user.role,
        tenantId:      user.tenantId,
        tenantName:    tenant?.name ?? form.tenantSlug,
        capabilities:  user.capabilities ?? {},
        canQuote:      user.canQuote ?? false,
      });

      // Load tenant preferences now that we're authenticated
      await refresh();

      router.replace(next);
    } catch {
      setError(t("serverError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" suppressHydrationWarning>
      {/* Workspace */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">{t("workspace")}</label>
        <div className="flex items-center rounded-lg border border-border overflow-hidden focus-within:ring-2 focus-within:ring-primary/30">
          <span className="border-r bg-muted px-3 py-2 text-sm text-muted-foreground select-none">
            nexcrm.app /
          </span>
          <input
            type="text"
            name="tenantSlug"
            autoComplete="organization"
            placeholder={t("workspacePlaceholder")}
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
        <label className="mb-1.5 block text-sm font-medium">{t("email")}</label>
        <input
          type="email"
          name="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
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
          <label className="text-sm font-medium">{t("password")}</label>
          <button type="button" className="text-xs text-primary hover:underline" tabIndex={-1}
            onClick={() => alert(t("forgotPasswordAlert"))}>
            {t("forgotPassword")}
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

      {(error || ssoError) && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error ?? SSO_ERRORS[ssoError ?? ""] ?? "Single sign-on failed. Please try again."}
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
        {loading ? t("signingIn") : t("signIn")}
      </button>

      {ssoOkta && (
        <>
          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <button
            type="button"
            onClick={startOkta}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
          >
            <ShieldCheck className="h-4 w-4 text-primary" />
            Sign in with Okta (SSO)
          </button>
        </>
      )}
    </form>
  );
}

export default function LoginPage() {
  const t = useTranslations("auth");

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border bg-card p-8 shadow-xl">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">NexCRM</h1>
          <p className="text-sm text-muted-foreground">{t("tagline")}</p>
        </div>

        <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("noWorkspace")}{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            {t("createFree")}
          </Link>
        </p>
      </div>
    </div>
  );
}
