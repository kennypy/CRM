"use client";

/**
 * SequenceBuilder — visual step editor for creating and editing sequences.
 * Provides: step creation, reordering, templates, settings, and save.
 */

import { useState, useEffect } from "react";
import { Plus, Save, Mail, Phone, Linkedin, Settings, RefreshCw, AlertCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StepCard, type SequenceStep } from "./StepCard";

interface Sequence {
  id:          string;
  name:        string;
  description: string | null;
  status:      string;
  goal:        string | null;
  settings:    {
    timezoneMode: "contact" | "rep" | "fixed";
    fixedTz:      string;
    sendDays:     number[];
    sendStart:    string;
    sendEnd:      string;
  };
}

interface SequenceBuilderProps {
  sequenceId?: string; // undefined = create new
  onSaved:     (id: string) => void;
  onCancel:    () => void;
}

const DEFAULT_SETTINGS: Sequence["settings"] = {
  timezoneMode: "contact",
  fixedTz:      "UTC",
  sendDays:     [1, 2, 3, 4, 5],
  sendStart:    "09:00",
  sendEnd:      "17:00",
};

const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SequenceBuilder({ sequenceId, onSaved, onCancel }: SequenceBuilderProps) {
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [goal,        setGoal]        = useState("");
  const [settings,    setSettings]    = useState(DEFAULT_SETTINGS);
  const [steps,       setSteps]       = useState<SequenceStep[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [loading,     setLoading]     = useState(!!sequenceId);
  const [error,       setError]       = useState<string | null>(null);
  const [originalStepIds, setOriginalStepIds] = useState<string[]>([]);

  // Load existing sequence for editing
  useEffect(() => {
    if (!sequenceId) return;
    Promise.all([
      api.get(`/api/v1/outreach/sequences/${sequenceId}`).then((r) => r.json()),
      api.get(`/api/v1/outreach/sequences/${sequenceId}/steps`).then((r) => r.json()),
    ]).then(([seqJson, stepsJson]) => {
      const seq: Sequence = seqJson.data;
      setName(seq.name);
      setDescription(seq.description ?? "");
      setGoal(seq.goal ?? "");
      setSettings({ ...DEFAULT_SETTINGS, ...(seq.settings ?? {}) });
      const loadedSteps = (stepsJson.data ?? []) as any[];
      setOriginalStepIds(loadedSteps.map((s: any) => s.id));
      setSteps(loadedSteps.map((s: any) => ({
        id:              s.id,
        stepNumber:      s.step_number,
        type:            s.type,
        dayOffset:       s.day_offset,
        timeOfDay:       s.time_of_day,
        subjectTemplate: s.subject_template ?? "",
        bodyTemplate:    s.body_template ?? "",
        taskNote:        s.task_note ?? "",
        aiSuggestions:   s.ai_suggestions ?? true,
      })));
    }).catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sequenceId]);

  function addStep(type: SequenceStep["type"]) {
    const nextNum = steps.length + 1;
    const prevOffset = steps[steps.length - 1]?.dayOffset ?? 0;
    setSteps([...steps, {
      stepNumber:   nextNum,
      type,
      dayOffset:    prevOffset === 0 && nextNum > 1 ? 3 : 0,
      timeOfDay:    "09:00",
      subjectTemplate: type === "email" ? "" : undefined,
      bodyTemplate:    type === "email" ? "" : undefined,
      taskNote:        type !== "email" ? "" : undefined,
      aiSuggestions:   true,
    }]);
  }

  function updateStep(index: number, updated: SequenceStep) {
    const newSteps = [...steps];
    newSteps[index] = { ...updated, stepNumber: index + 1 };
    setSteps(newSteps);
  }

  function deleteStep(index: number) {
    const newSteps = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepNumber: i + 1 }));
    setSteps(newSteps);
  }

  function moveStep(from: number, to: number) {
    const arr = [...steps];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    setSteps(arr.map((s, i) => ({ ...s, stepNumber: i + 1 })));
  }

  function toggleSendDay(day: number) {
    const days = settings.sendDays;
    const updated = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    setSettings({ ...settings, sendDays: updated });
  }

  async function handleSave() {
    if (!name.trim()) { setError("Sequence name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      // Create or update the sequence
      let id = sequenceId;
      if (!id) {
        const res  = await api.post("/api/v1/outreach/sequences", { name, description, goal, settings });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? "Failed to create sequence");
        id = json.data.id;
      } else {
        const res = await api.patch(`/api/v1/outreach/sequences/${id}`, { name, description, goal, settings });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error?.message ?? "Failed to update"); }
      }

      // Upsert all steps
      for (const step of steps) {
        const res = await api.post(`/api/v1/outreach/sequences/${id}/steps`, {
          stepNumber:      step.stepNumber,
          type:            step.type,
          dayOffset:       step.dayOffset,
          timeOfDay:       step.timeOfDay,
          subjectTemplate: step.subjectTemplate,
          bodyTemplate:    step.bodyTemplate,
          taskNote:        step.taskNote,
          aiSuggestions:   step.aiSuggestions,
        });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error?.message ?? `Step ${step.stepNumber} failed`); }
      }

      // Delete steps that were removed in the UI
      const currentIds = new Set(steps.filter((s) => s.id).map((s) => s.id));
      const removed = originalStepIds.filter((sid) => !currentIds.has(sid));
      for (const stepId of removed) {
        await api.delete(`/api/v1/outreach/sequences/${id}/steps/${stepId}`);
      }

      onSaved(id!);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <RefreshCw className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold">{sequenceId ? "Edit Sequence" : "New Sequence"}</h2>
          <p className="text-xs text-muted-foreground">{steps.length} step{steps.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings((v) => !v)} className={cn("rounded-md border border-border p-2 text-muted-foreground hover:bg-muted", showSettings && "bg-muted text-foreground")}>
            <Settings className="h-4 w-4" />
          </button>
          <button onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "Saving…" : "Save Sequence"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {/* Meta */}
        <div className="mb-6 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sequence name *"
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal (e.g. Book a demo)"
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Schedule settings */}
        {showSettings && (
          <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4 space-y-4">
            <h3 className="text-sm font-medium">Schedule Settings</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Timezone mode</label>
                <select
                  value={settings.timezoneMode}
                  onChange={(e) => setSettings({ ...settings, timezoneMode: e.target.value as any })}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="contact">Contact timezone</option>
                  <option value="rep">Rep timezone (UTC)</option>
                  <option value="fixed">Fixed timezone</option>
                </select>
              </div>
              {settings.timezoneMode === "fixed" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Timezone</label>
                  <input
                    type="text"
                    value={settings.fixedTz}
                    onChange={(e) => setSettings({ ...settings, fixedTz: e.target.value })}
                    placeholder="America/New_York"
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Send window</label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={settings.sendStart}
                    onChange={(e) => setSettings({ ...settings, sendStart: e.target.value })}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={settings.sendEnd}
                    onChange={(e) => setSettings({ ...settings, sendEnd: e.target.value })}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Send days</label>
                <div className="flex gap-1 flex-wrap">
                  {[1,2,3,4,5,6,7].map((d) => (
                    <button
                      key={d}
                      onClick={() => toggleSendDay(d)}
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        settings.sendDays.includes(d)
                          ? "bg-primary text-primary-foreground"
                          : "border border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {DAY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="space-y-3">
          {steps.map((step, i) => (
            <StepCard
              key={`${step.stepNumber}-${i}`}
              step={step}
              index={i}
              total={steps.length}
              onChange={(updated) => updateStep(i, updated)}
              onDelete={() => deleteStep(i)}
              onMoveUp={i > 0 ? () => moveStep(i, i - 1) : undefined}
              onMoveDown={i < steps.length - 1 ? () => moveStep(i, i + 1) : undefined}
            />
          ))}
        </div>

        {/* Add step buttons */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Add step:</span>
          {([
            { type: "email",         icon: Mail,     label: "Email" },
            { type: "call",          icon: Phone,    label: "Call" },
            { type: "linkedin_task", icon: Linkedin, label: "LinkedIn" },
          ] as const).map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              onClick={() => addStep(type)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
