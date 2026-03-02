"use client";

import { CheckCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreamChunk {
  type: "thinking" | "result" | "action" | "error";
  content: string;
  data?: Record<string, unknown>;
}

export function CommandResult({ chunk }: { chunk: StreamChunk }) {
  if (chunk.type === "thinking") {
    return (
      <div className="px-3 py-1.5 text-xs text-muted-foreground italic">
        {chunk.content}
      </div>
    );
  }

  if (chunk.type === "error") {
    return (
      <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {chunk.content}
      </div>
    );
  }

  if (chunk.type === "action") {
    return (
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="flex-1 text-sm">
            <p>{chunk.content}</p>
            {chunk.data && (
              <div className="mt-2 flex gap-2">
                <button className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                  Confirm
                </button>
                <button className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted">
                  Edit
                </button>
                <button className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted">
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default: result
  return (
    <div className="rounded-md px-3 py-2 text-sm">
      <p>{chunk.content}</p>
    </div>
  );
}
