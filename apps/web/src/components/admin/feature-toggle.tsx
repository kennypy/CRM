"use client";

import { cn } from "@/lib/utils";

const KNOWN_FEATURES: { key: string; label: string; description: string }[] = [
  { key: "commandBar", label: "Command Bar", description: "AI-powered command bar (Cmd+K)" },
  { key: "realityScore", label: "Reality Score", description: "AI deal reality scoring" },
  { key: "reviewQueue", label: "Review Queue", description: "AI extraction review queue" },
  { key: "sequences", label: "Sequences", description: "Email outreach sequences" },
  { key: "workflows", label: "Workflows", description: "Automated workflow engine" },
  { key: "aiEngine", label: "AI Engine", description: "Core AI extraction and analysis" },
  { key: "customObjects", label: "Custom Objects", description: "User-defined objects and fields" },
  { key: "quotes", label: "Quotes", description: "Quote and proposal generation" },
  { key: "reports", label: "Reports", description: "Reporting and analytics" },
  { key: "slackIntegration", label: "Slack Integration", description: "Slack notification and sync" },
];

export function FeatureToggleList({
  features,
  onToggle,
  saving,
}: {
  features: Record<string, boolean>;
  onToggle: (key: string, enabled: boolean) => void;
  saving?: string | null;
}) {
  return (
    <div className="divide-y rounded-xl border bg-card">
      {KNOWN_FEATURES.map(({ key, label, description }) => {
        const enabled = features[key] ?? false;
        const isSaving = saving === key;
        return (
          <div key={key} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <button
              onClick={() => onToggle(key, !enabled)}
              disabled={isSaving}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out",
                enabled ? "bg-primary" : "bg-muted-foreground/30",
                isSaving && "opacity-50"
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ease-in-out mt-0.5",
                  enabled ? "translate-x-5 ml-0.5" : "translate-x-0.5"
                )}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
