"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { setAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant-context";
import { Zap, AlertCircle, MailCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { TurnstileWidget, turnstileEnabled } from "@/components/turnstile";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useTenant();
  const t = useTranslations("auth");
  const [form, setForm] = useState({
    orgName: "", tenantSlug: "", firstName: "", lastName: "", email: "", password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [awaitingVerification, setAwaitingVerification] = useState(false);

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
        ...(turnstileToken ? { turnstileToken } : {}),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data?.error?.message ?? data?.error) ?? t("registrationFailed"));
        return;
      }

      const data = await res.json();
      // Sandbox signup: no session yet — the email must be verified first.
      if (data?.data?.verificationRequired) {
        setAwaitingVerification(true);
        return;
      }
      const { user, tenant } = data.data ?? data;
      setAuth("", "", {
        id: user.id, email: user.email,
        firstName: user.firstName, lastName: user.lastName,
        role: user.role, tenantId: user.tenantId, tenantName: tenant?.name ?? form.orgName,
      });
      await refresh();
      router.replace("/");
    } catch {
      setError(t("serverError"));
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

  if (awaitingVerification) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border bg-card p-8 shadow-xl">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
              <MailCheck className="h-7 w-7 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-2xl font-bold">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              We&apos;ve sent a verification link to <strong>{form.email}</strong>.
              Your sandbox activates as soon as you click it — the link expires in 24 hours.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">{t("createWorkspace")}</h1>
          <p className="text-sm text-muted-foreground">{t("trialInfo")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("orgName")}</label>
            <input
              type="text"
              placeholder={t("orgPlaceholder")}
              value={form.orgName}
              onChange={(e) => handleOrgChange(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("workspaceUrl")}</label>
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
            {field(t("firstName"), "firstName", "text", "Ada")}
            {field(t("lastName"),  "lastName",  "text", "Lovelace")}
          </div>
          {field(t("workEmail"), "email",    "email",    t("emailPlaceholder"))}
          {field(t("password"),  "password", "password", "••••••••")}

          <TurnstileWidget onToken={setTurnstileToken} />

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (turnstileEnabled && !turnstileToken)}
            className={cn(
              "w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity",
              loading ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"
            )}
          >
            {loading ? t("creatingWorkspace") : t("createWorkspaceBtn")}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t("alreadyHaveWorkspace")}{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">{t("signIn")}</Link>
        </p>
      </div>
    </div>
  );
}
