"use client";

import { useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  X, Zap, Briefcase, Users, Activity, ArrowRight,
  CheckCircle2, XCircle, Clock, Play,
} from "lucide-react";

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
  createdBy?: string;
}

interface ActiveDeal {
  type: "deal";
  id: string;
  name: string;
  company: string;
  stage: string;
  value: string;
  enteredAt: string;
}

interface ActiveContact {
  type: "contact";
  id: string;
  name: string;
  company: string;
  email: string;
  enteredAt: string;
}

interface ActiveActivity {
  type: "activity";
  id: string;
  activityType: string;
  deal: string;
  contact: string;
  enteredAt: string;
}

type ActiveEntity = ActiveDeal | ActiveContact | ActiveActivity;

interface RunEntry {
  id: string;
  entityName: string;
  status: "success" | "failed";
  runAt: string;
}

// Demo data keyed by workflow ID
const ACTIVE_ENTITIES: Record<string, ActiveEntity[]> = {
  "1": [
    { type: "deal", id: "d1", name: "Acme Corp — Enterprise Suite", company: "Acme Corp", stage: "Negotiation", value: "$280,000", enteredAt: "2h ago" },
    { type: "deal", id: "d2", name: "Globex — Platform License", company: "Globex Corp", stage: "Negotiation", value: "$195,000", enteredAt: "5h ago" },
  ],
  "2": [
    { type: "deal", id: "d3", name: "Initech — Starter Plan", company: "Initech", stage: "Proposal", value: "$42,000", enteredAt: "8 days ago" },
    { type: "deal", id: "d4", name: "Umbrella Co — Enterprise", company: "Umbrella Co", stage: "Discovery", value: "$450,000", enteredAt: "15 days ago" },
    { type: "deal", id: "d5", name: "Cyberdyne — Core", company: "Cyberdyne", stage: "Proposal", value: "$88,000", enteredAt: "10 days ago" },
  ],
  "3": [
    { type: "contact", id: "c1", name: "Maria Garcia", company: "TechStart Inc", email: "maria@techstart.io", enteredAt: "1d ago" },
    { type: "contact", id: "c2", name: "James Wilson", company: "Pied Piper", email: "james@piedpiper.com", enteredAt: "2d ago" },
  ],
  "4": [],
  "5": [
    { type: "deal", id: "d6", name: "Hooli — Premium", company: "Hooli", stage: "Closed Won", value: "$320,000", enteredAt: "1d ago" },
  ],
  "6": [
    { type: "activity", id: "a1", activityType: "meeting", deal: "Acme Corp — Enterprise Suite", contact: "Sarah Chen", enteredAt: "30m ago" },
    { type: "activity", id: "a2", activityType: "meeting", deal: "Globex — Platform License", contact: "Marcus Lee", enteredAt: "2h ago" },
    { type: "activity", id: "a3", activityType: "meeting", deal: "Initech — Starter Plan", contact: "Priya Patel", enteredAt: "4h ago" },
  ],
};

const RUN_HISTORY: Record<string, RunEntry[]> = {
  "1": [
    { id: "r1", entityName: "Acme Corp — Enterprise Suite", status: "success", runAt: "2h ago" },
    { id: "r2", entityName: "Globex — Platform License", status: "success", runAt: "5h ago" },
    { id: "r3", entityName: "Pied Piper — Series A", status: "failed", runAt: "1d ago" },
    { id: "r4", entityName: "Initech — Starter Plan", status: "success", runAt: "3d ago" },
  ],
  "2": [
    { id: "r1", entityName: "Umbrella Co — Enterprise", status: "success", runAt: "6h ago" },
    { id: "r2", entityName: "Cyberdyne — Core", status: "success", runAt: "10h ago" },
    { id: "r3", entityName: "Initech — Starter Plan", status: "success", runAt: "2d ago" },
  ],
  "3": [
    { id: "r1", entityName: "Maria Garcia", status: "success", runAt: "1d ago" },
    { id: "r2", entityName: "James Wilson", status: "success", runAt: "2d ago" },
    { id: "r3", entityName: "Alex Kim", status: "failed", runAt: "5d ago" },
  ],
  "4": [
    { id: "r1", entityName: "demo-review-123", status: "success", runAt: "3d ago" },
  ],
  "5": [
    { id: "r1", entityName: "Hooli — Premium", status: "success", runAt: "1d ago" },
    { id: "r2", entityName: "Acme Corp — Growth", status: "success", runAt: "4d ago" },
  ],
  "6": [
    { id: "r1", entityName: "Acme Corp — Q4 QBR", status: "success", runAt: "30m ago" },
    { id: "r2", entityName: "Globex kickoff", status: "success", runAt: "2h ago" },
    { id: "r3", entityName: "Initech discovery", status: "success", runAt: "4h ago" },
  ],
};

const CATEGORY_ICON: Record<string, React.FC<{ className?: string }>> = {
  deal:     Briefcase,
  contact:  Users,
  activity: Activity,
  ai:       Zap,
};

const CATEGORY_CLR: Record<string, string> = {
  deal:     "bg-blue-100 text-blue-700",
  contact:  "bg-purple-100 text-purple-700",
  activity: "bg-green-100 text-green-700",
  ai:       "bg-orange-100 text-orange-700",
};

export function WorkflowActivePanel({
  workflow, onClose,
}: {
  workflow: Workflow;
  onClose: () => void;
}) {
  const active  = ACTIVE_ENTITIES[workflow.id] ?? [];
  const history = RUN_HISTORY[workflow.id] ?? [];
  const CatIcon = CATEGORY_ICON[workflow.category] ?? Zap;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l bg-background shadow-2xl">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className={cn("mt-0.5 rounded-lg p-2 shrink-0", CATEGORY_CLR[workflow.category])}>
                <CatIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-base leading-tight">{workflow.name}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{workflow.description}</p>
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Trigger */}
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs">
            <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <div>
              <span className="font-medium text-foreground">{workflow.trigger}</span>
              <div className="mt-1.5 space-y-1 text-muted-foreground">
                {workflow.actions.map((action, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    {action}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Play className="h-3 w-3" /> {workflow.runCount} total runs
            </span>
            {workflow.lastRun && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Last run {workflow.lastRun}
              </span>
            )}
            <span className={cn(
              "ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              workflow.enabled ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
            )}>
              {workflow.enabled ? "Active" : "Disabled"}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto divide-y">
          {/* Currently active */}
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Currently Active On</h3>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {active.length} {active.length === 1 ? "entity" : "entities"}
              </span>
            </div>

            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4 text-center">
                {workflow.enabled ? "No entities currently in-flight." : "Workflow is disabled — no active runs."}
              </p>
            ) : (
              <div className="space-y-2">
                {active.map((entity) => (
                  <ActiveEntityRow key={entity.id} entity={entity} />
                ))}
              </div>
            )}
          </div>

          {/* Run history */}
          <div className="px-6 py-5">
            <h3 className="text-sm font-semibold mb-3">Recent Run History</h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No runs recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((run) => (
                  <div key={run.id} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2">
                    {run.status === "success"
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      : <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                    }
                    <span className="flex-1 min-w-0 text-sm truncate">{run.entityName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{run.runAt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ActiveEntityRow({ entity }: { entity: ActiveEntity }) {
  if (entity.type === "deal") {
    return (
      <Link href="/pipeline"
        className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 hover:border-primary/30 hover:bg-muted/30 transition-colors">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100">
          <Briefcase className="h-3.5 w-3.5 text-blue-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{entity.name}</p>
          <p className="text-xs text-muted-foreground">{entity.company} · {entity.stage} · {entity.value}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">entered</p>
          <p className="text-xs font-medium">{entity.enteredAt}</p>
        </div>
      </Link>
    );
  }

  if (entity.type === "contact") {
    return (
      <Link href="/contacts"
        className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 hover:border-primary/30 hover:bg-muted/30 transition-colors">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100">
          <Users className="h-3.5 w-3.5 text-purple-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{entity.name}</p>
          <p className="text-xs text-muted-foreground truncate">{entity.company} · {entity.email}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">enrolled</p>
          <p className="text-xs font-medium">{entity.enteredAt}</p>
        </div>
      </Link>
    );
  }

  // activity
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100">
        <Activity className="h-3.5 w-3.5 text-green-700" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium capitalize">{entity.activityType}</p>
        <p className="text-xs text-muted-foreground truncate">{entity.deal} · {entity.contact}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-muted-foreground">{entity.enteredAt}</p>
      </div>
    </div>
  );
}
