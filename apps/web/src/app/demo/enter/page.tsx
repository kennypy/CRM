"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Play, Loader2 } from "lucide-react";

export default function DemoEnterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enterDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/session", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to start demo session");
        return;
      }
      const data = await res.json();
      const { user, tenant } = data.data ?? {};
      // Store user profile in localStorage (same as normal login)
      if (user) {
        localStorage.setItem(
          "nexcrm_user",
          JSON.stringify({
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            tenantId: user.tenantId,
            tenantName: tenant?.name ?? "NexCRM Demo",
          })
        );
      }
      // Demo session cookie is now set — redirect to dashboard
      router.replace("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-600/25">
              <Zap className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Try NexCRM Demo</h1>
            <p className="text-center text-sm text-gray-500">
              Explore a fully loaded CRM with realistic pipeline data.
              No signup required. Read-only access.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">What you&apos;ll see:</h3>
              <ul className="space-y-1.5 text-sm text-gray-600">
                <li>&#x2022; 10 companies across multiple industries</li>
                <li>&#x2022; 25+ contacts with relationship mapping</li>
                <li>&#x2022; 8 active deals at every pipeline stage</li>
                <li>&#x2022; AI Reality Scores with risk analysis</li>
                <li>&#x2022; 100+ activities (emails, calls, meetings)</li>
                <li>&#x2022; Buying group intelligence</li>
              </ul>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={enterDemo}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading demo...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Enter Demo
                </>
              )}
            </button>

            <p className="text-center text-xs text-gray-400">
              Demo data resets periodically. All actions are read-only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
