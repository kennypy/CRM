"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Layers, Plus, Play, Pause, Zap, AlertCircle, CheckCircle2, Clock, ArrowRight } from "lucide-react";

interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  actions: string[];
  enabled: boolean;
  lastRun?: string;
  runCount: number;
  category: "deal" | "contact" | "activity" | "ai";
}

const DEMO_WORKFLOWS: Workflow[] = [
  {
    id: "1",
    name: "Deal → Negotiation: Legal task",
    description: "Creates a legal review task and notifies the manager when a deal reaches Negotiation stage.",
    trigger: "Deal moved to Negotiation",
    actions: ["Create task: Legal review", "Notify manager via email"],
    enabled: true,
    lastRun: "2h ago",
    runCount: 23,
    category: "deal",
  },
  {
    id: "2",
    name: "Stale deal alert",
    description: "Sends a Slack alert when a deal has had no activity for 7+ days.",
    trigger: "Deal inactive for 7 days",
    actions: ["Send Slack message to owner", "Create follow-up task"],
    enabled: true,
    lastRun: "6h ago",
    runCount: 47,
    category: "deal",
  },
  {
    id: "3",
    name: "New contact auto-sequence",
    description: "Enrols new auto-captured contacts into a 3-step email nurture sequence.",
    trigger: "Contact auto-captured (confidence ≥ 90%)",
    actions: ["Add to nurture sequence", "Score as lead", "Assign to rep"],
    enabled: true,
    lastRun: "1d ago",
    runCount: 118,
    category: "contact",
  },
  {
    id: "4",
    name: "AI review queue escalation",
    description: "Notifies the team if review queue items are pending for more than 24 hours.",
    trigger: "Review queue item pending > 24h",
    actions: ["Email ops team", "Create urgent task"],
    enabled: false,
    lastRun: "3d ago",
    runCount: 8,
    category: "ai",
  },
  {
    id: "5",
    name: "Closed-won celebration",
    description: "Posts a win announcement to Slack and creates an onboarding task when a deal closes.",
    trigger: "Deal moved to Closed Won",
    actions: ["Post to #wins Slack channel", "Create onboarding task", "Update CRM stats"],
    enabled: true,
    lastRun: "1d ago",
    runCount: 18,
    category: "deal",
  },
  {
    id: "6",
    name: "Meeting → summary extraction",
    description: "Automatically extracts action items and next steps from every meeting transcript.",
    trigger: "Meeting activity created",
    actions: ["Extract action items (AI)", "Create tasks from action items", "Update deal notes"],
    enabled: true,
    lastRun: "30m ago",
    runCount: 234,
    category: "activity",
  },
];

const CATEGORY_CFG: Record<string, { label: string; cls: string }> = {
  deal:     { label: "Deal",     cls: "bg-blue-100 text-blue-700" },
  contact:  { label: "Contact",  cls: "bg-purple-100 text-purple-700" },
  activity: { label: "Activity", cls: "bg-green-100 text-green-700" },
  ai:       { label: "AI",       cls: "bg-orange-100 text-orange-700" },
};

type Filter = "all" | "deal" | "contact" | "activity" | "ai";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>(DEMO_WORKFLOWS);
  const [filter, setFilter]       = useState<Filter>("all");

  const toggle = (id: string) =>
    setWorkflows((ws) => ws.map((w) => w.id === id ? { ...w, enabled: !w.enabled } : w));

  const filtered = filter === "all" ? workflows : workflows.filter((w) => w.category === filter);
  const active   = workflows.filter((w) => w.enabled).length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Workflows</h1>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            {active} active
          </span>
        </div>
        <button className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New Workflow
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-700">
        <Zap className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Workflows run automatically based on triggers. They replace manual follow-ups and ensure every deal gets the right attention at the right time.</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["all", "deal", "contact", "activity", "ai"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >{f === "all" ? "All" : CATEGORY_CFG[f].label}</button>
        ))}
      </div>

      {/* Workflow cards */}
      <div className="flex-1 overflow-auto">
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((wf) => (
            <div key={wf.id} className={cn("rounded-xl border bg-card p-5 transition-opacity", !wf.enabled && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", CATEGORY_CFG[wf.category].cls)}>
                      {CATEGORY_CFG[wf.category].label}
                    </span>
                    {wf.enabled
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      : <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </div>
                  <h3 className="font-semibold text-sm">{wf.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{wf.description}</p>
                </div>
                {/* Toggle */}
                <button
                  onClick={() => toggle(wf.id)}
                  className={cn(
                    "shrink-0 flex h-7 w-12 items-center rounded-full px-1 transition-colors",
                    wf.enabled ? "bg-primary justify-end" : "bg-muted justify-start"
                  )}
                >
                  <div className="h-5 w-5 rounded-full bg-background shadow-sm" />
                </button>
              </div>

              {/* Trigger → actions */}
              <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs">
                <div className="flex items-start gap-2 mb-2">
                  <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <span className="font-medium text-foreground">{wf.trigger}</span>
                </div>
                <div className="space-y-1 pl-5">
                  {wf.actions.map((action, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      {action}
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Play className="h-3 w-3" /> {wf.runCount} runs
                </span>
                {wf.lastRun && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Last run {wf.lastRun}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
