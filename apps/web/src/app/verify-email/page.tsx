"use client";

/**
 * Landing page for the email-verification link sent on sandbox signup.
 * Consumes the token via /api/auth/verify-email (which sets session cookies
 * on success) and drops the user straight into the app.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, AlertCircle, Zap } from "lucide-react";
import { setAuth } from "@/lib/auth";

function VerifyEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? "";
  const [state, setState] = useState<"verifying" | "done" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // React strict-mode double-invoke guard
    ran.current = true;

    if (!token) {
      setState("error");
      setError("This verification link is missing its token.");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState("error");
          setError(data?.error?.message ?? "This verification link is invalid or has expired.");
          return;
        }
        const { user, tenant } = data?.data ?? {};
        if (user) {
          try {
            setAuth("", "", {
              id:           user.id,
              email:        user.email,
              firstName:    user.firstName,
              lastName:     user.lastName,
              role:         user.role,
              tenantId:     user.tenantId,
              tenantName:   tenant?.name ?? "",
              capabilities: user.capabilities ?? {},
              canQuote:     user.canQuote ?? false,
            });
          } catch { /* non-fatal */ }
        }
        setState("done");
        setTimeout(() => router.push("/dashboard"), 1500);
      } catch {
        setState("error");
        setError("Network error. Please try the link again.");
      }
    })();
  }, [token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-600/25">
              <Zap className="h-7 w-7 text-white" />
            </div>
            {state === "verifying" && (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
                <h1 className="text-2xl font-bold text-gray-900">Verifying your email…</h1>
              </>
            )}
            {state === "done" && (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle2 className="h-7 w-7 text-green-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Email verified!</h1>
                <p className="text-gray-600">
                  Your sandbox is being prepared with sample data. Taking you in…
                </p>
              </>
            )}
            {state === "error" && (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                  <AlertCircle className="h-7 w-7 text-red-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Verification failed</h1>
                <p className="text-gray-600">{error}</p>
                <Link
                  href="/login"
                  className="mt-4 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Go to Login
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
