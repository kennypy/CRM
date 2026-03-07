"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GitMerge } from "lucide-react";
import { api } from "@/lib/api";

export default function MergesListPage() {
  // This is a placeholder — merges are initiated from workspace detail pages.
  // Users land here from the nav and can see active/recent merges.
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workspace Merges</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Merge workspaces by navigating to a workspace and clicking "Merge Into"
        </p>
      </div>

      <div className="rounded-xl border bg-card p-12 text-center">
        <GitMerge className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">
          To start a merge, go to a workspace detail page and click "Merge Into"
        </p>
        <Link
          href="/admin/workspaces"
          className="mt-3 inline-block text-sm text-primary hover:underline"
        >
          Go to Workspaces
        </Link>
      </div>
    </div>
  );
}
