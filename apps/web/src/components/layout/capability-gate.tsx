"use client";

import Link from "next/link";
import { CloudOff } from "lucide-react";
import {
  useInstanceCapabilities,
  type InstanceCapabilities,
} from "@/lib/capabilities-context";

/**
 * Wrap a page whose backing service may be absent from this deployment
 * (see the instance capability manifest). When the capability is missing the
 * page shows an honest "not available on this instance" placeholder instead
 * of rendering controls that fail at runtime. Nav links are also hidden, but
 * this covers direct URLs and stale links.
 */
export function CapabilityGate({
  capability,
  title,
  children,
}: {
  capability: keyof InstanceCapabilities;
  title: string;
  children: React.ReactNode;
}) {
  const { capabilities } = useInstanceCapabilities();
  if (capabilities[capability] !== false) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full bg-muted p-4">
        <CloudOff className="h-8 w-8 text-muted-foreground" />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{title} isn&apos;t available on this instance</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The service behind this feature isn&apos;t deployed here. On a full
        NexCRM deployment this page works out of the box.
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
