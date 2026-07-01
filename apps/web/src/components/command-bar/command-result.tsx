"use client";

import { useState } from "react";
import { CheckCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { executeCommandAction } from "@/lib/command-actions";

interface StreamChunk {
  type: "thinking" | "result" | "action" | "error";
  content: string;
  data?: Record<string, unknown>;
}

function ActionCard({ chunk }: { chunk: StreamChunk }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error" | "dismissed">("idle");
  const [message, setMessage] = useState("");

  const run = async () => {
    setState("running");
    const result = await executeCommandAction(chunk.data ?? {});
    setMessage(result.message);
    setState(result.ok ? "done" : "error");
  };

  if (state === "dismissed") return null;

  if (state === "done" || state === "error") {
    return (
      <div
        className={
          state === "done"
            ? "flex items-start gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700"
            : "flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        }
      >
        {state === "done" ? (
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        {message}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1 text-sm">
          <p>{chunk.content}</p>
          {chunk.data && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={run}
                disabled={state === "running"}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {state === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                {state === "running" ? "Running..." : "Confirm"}
              </button>
              <button
                onClick={() => setState("dismissed")}
                className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
    return <ActionCard chunk={chunk} />;
  }

  // Default: result
  return (
    <div className="rounded-md px-3 py-2 text-sm">
      <p>{chunk.content}</p>
    </div>
  );
}
