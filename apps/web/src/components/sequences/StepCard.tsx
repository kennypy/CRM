"use client";

import { useState } from "react";
import { Mail, Phone, Linkedin, MessageSquare, Clock, Trash2, ChevronDown, ChevronUp, GripVertical, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SequenceStep {
  id?:             string;
  stepNumber:      number;
  type:            "email" | "call" | "linkedin_task" | "sms" | "task";
  dayOffset:       number;
  timeOfDay:       string;
  subjectTemplate?: string;
  bodyTemplate?:   string;
  taskNote?:       string;
  aiSuggestions:   boolean;
  settings?:       Record<string, unknown>;
}

interface StepCardProps {
  step:       SequenceStep;
  index:      number;
  total:      number;
  onChange:   (updated: SequenceStep) => void;
  onDelete:   () => void;
  onMoveUp?:  () => void;
  onMoveDown?:() => void;
}

const TYPE_CONFIG = {
  email:         { icon: Mail,          label: "Email",         color: "text-blue-600",   bg: "bg-blue-50",   border: "border-blue-200" },
  call:          { icon: Phone,         label: "Call Task",     color: "text-green-600",  bg: "bg-green-50",  border: "border-green-200" },
  linkedin_task: { icon: Linkedin,      label: "LinkedIn Task", color: "text-sky-600",    bg: "bg-sky-50",    border: "border-sky-200" },
  sms:           { icon: MessageSquare, label: "SMS",           color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" },
  task:          { icon: Clock,         label: "Manual Task",   color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
} as const;

export function StepCard({ step, index, total, onChange, onDelete, onMoveUp, onMoveDown }: StepCardProps) {
  const [expanded, setExpanded] = useState(true);
  const cfg = TYPE_CONFIG[step.type];
  const Icon = cfg.icon;

  function update(patch: Partial<SequenceStep>) {
    onChange({ ...step, ...patch });
  }

  const DAYS = ["00:00","06:00","07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"];

  return (
    <div className={cn("rounded-lg border", cfg.border)}>
      {/* Header */}
      <div className={cn("flex items-center gap-3 rounded-t-lg px-4 py-3", cfg.bg)}>
        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-full border bg-white", cfg.border)}>
          <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <span className={cn("text-sm font-medium", cfg.color)}>
            Step {step.stepNumber} — {cfg.label}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            Day {step.dayOffset} at {step.timeOfDay}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {index > 0 && onMoveUp && (
            <button onClick={onMoveUp} className="rounded p-1 text-muted-foreground hover:bg-white/60 hover:text-foreground">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          )}
          {index < total - 1 && onMoveDown && (
            <button onClick={onMoveDown} className="rounded p-1 text-muted-foreground hover:bg-white/60 hover:text-foreground">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setExpanded((v) => !v)} className="rounded p-1 text-muted-foreground hover:bg-white/60">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button onClick={onDelete} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="space-y-3 p-4">
          {/* Timing row */}
          <div className="flex items-center gap-4">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Day offset</label>
              <input
                type="number"
                min={0}
                max={365}
                value={step.dayOffset}
                onChange={(e) => update({ dayOffset: parseInt(e.target.value, 10) || 0 })}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-[11px] text-muted-foreground">Days after enrollment (or last step)</span>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Send time</label>
              <select
                value={step.timeOfDay}
                onChange={(e) => update({ timeOfDay: e.target.value })}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {DAYS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="text-[11px] text-muted-foreground">In contact's timezone</span>
            </div>
          </div>

          {/* Email-specific fields */}
          {step.type === "email" && (
            <>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Subject template</label>
                  <span className="text-[11px] text-muted-foreground">Use {"{{first_name}}"}, {"{{company}}"}</span>
                </div>
                <input
                  type="text"
                  value={step.subjectTemplate ?? ""}
                  onChange={(e) => update({ subjectTemplate: e.target.value })}
                  placeholder="Quick question, {{first_name}}"
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Body template</label>
                <textarea
                  value={step.bodyTemplate ?? ""}
                  onChange={(e) => update({ bodyTemplate: e.target.value })}
                  placeholder={`Hi {{first_name}},\n\nI wanted to reach out…`}
                  rows={6}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={step.aiSuggestions}
                  onChange={(e) => update({ aiSuggestions: e.target.checked })}
                  className="rounded"
                />
                <Wand2 className="h-3 w-3 text-primary" />
                Enable AI suggestions when composing this step
              </label>
            </>
          )}

          {/* Call / LinkedIn task fields */}
          {(step.type === "call" || step.type === "linkedin_task") && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                {step.type === "call" ? "Call note / talking points" : "LinkedIn task note"}
              </label>
              <textarea
                value={step.taskNote ?? ""}
                onChange={(e) => update({ taskNote: e.target.value })}
                placeholder={step.type === "call" ? "Mention the case study they downloaded…" : "Connect and reference our last email…"}
                rows={4}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
