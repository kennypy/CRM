import { Sparkles, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";

// Server component — fetches AI brief on the server
async function fetchBrief() {
  // In production this calls the AI Engine
  // For now, returns mock data
  return {
    summary:
      "You have 3 deals requiring attention today. Acme Corp hasn't had activity in 8 days and their close date is in 12 days. Two new signals suggest TechStart is accelerating their evaluation.",
    signals: [
      { type: "at_risk", label: "Acme Corp — 8 days dark", severity: "high" },
      { type: "opportunity", label: "TechStart — accelerating", severity: "positive" },
      { type: "task", label: "4 follow-ups due today", severity: "medium" },
    ],
  };
}

export async function IntelligenceBrief() {
  const brief = await fetchBrief();

  return (
    <div className="rounded-xl border bg-gradient-to-r from-primary/5 to-accent/5 p-6">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1">
          <h2 className="mb-2 font-semibold">Today's Intelligence Brief</h2>
          <p className="text-sm text-muted-foreground">{brief.summary}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {brief.signals.map((signal, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                  signal.severity === "high"
                    ? "bg-destructive/10 text-destructive"
                    : signal.severity === "positive"
                    ? "bg-success/10 text-success"
                    : "bg-warning/10 text-warning"
                }`}
              >
                {signal.severity === "high" ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : signal.severity === "positive" ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <CheckCircle className="h-3 w-3" />
                )}
                {signal.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
