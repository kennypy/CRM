"use client";

import Link from "next/link";
import { Construction } from "lucide-react";
import { previewEnabled } from "@/lib/feature-flags";

/**
 * Wrap a preview-grade page so that, unless preview mode is explicitly enabled,
 * direct navigation shows an honest "not available yet" placeholder instead of
 * simulated/hardcoded data. This keeps fabricated numbers out of pilot tenants
 * even when a user types the URL or follows a stale link.
 */
export function PreviewGate({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  if (previewEnabled()) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full bg-muted p-4">
        <Construction className="h-8 w-8 text-muted-foreground" />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{title} — coming soon</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This feature is still in development and isn&apos;t part of the current
        release. We&apos;ve hidden it rather than show placeholder data.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
