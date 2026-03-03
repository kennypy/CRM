"use client";

import { useState } from "react";
import { formatRelativeTime, cn } from "@/lib/utils";
import {
  CheckSquare, Plus, AlertCircle, Clock, CheckCircle2,
  Circle, Briefcase, Users, ChevronDown,
} from "lucide-react";

type Priority = "high" | "medium" | "low";
type Status   = "open" | "in_progress" | "done";

interface Task {
  id: string;
  title: string;
  priority: Priority;
  status: Status;
  dueDate: string;
  assignee: string;
  linkedEntity?: { type: "deal" | "contact"; name: string };
  createdAt: string;
}

// Static demo tasks that make the page immediately useful
const DEMO_TASKS: Task[] = [
  { id: "1", title: "Follow up with Acme Corp legal team",       priority: "high",   status: "open",        dueDate: new Date(Date.now() - 86400000).toISOString(),   assignee: "You",        linkedEntity: { type: "deal",    name: "Acme Enterprise" }, createdAt: new Date().toISOString() },
  { id: "2", title: "Send proposal to TechStart",                priority: "high",   status: "in_progress", dueDate: new Date(Date.now() + 86400000).toISOString(),   assignee: "You",        linkedEntity: { type: "deal",    name: "TechStart Growth" }, createdAt: new Date().toISOString() },
  { id: "3", title: "Schedule demo with Globex stakeholders",    priority: "medium", status: "open",        dueDate: new Date(Date.now() + 172800000).toISOString(),  assignee: "Sarah Kim",  linkedEntity: { type: "contact", name: "John Globex" }, createdAt: new Date().toISOString() },
  { id: "4", title: "Update CRM notes after Acme call",          priority: "low",    status: "done",        dueDate: new Date(Date.now() - 172800000).toISOString(),  assignee: "You",        linkedEntity: { type: "deal",    name: "Acme Enterprise" }, createdAt: new Date().toISOString() },
  { id: "5", title: "Prepare Q1 pipeline review deck",           priority: "medium", status: "open",        dueDate: new Date(Date.now() + 432000000).toISOString(),  assignee: "You",        createdAt: new Date().toISOString() },
  { id: "6", title: "Review and approve 7 AI extractions",       priority: "high",   status: "open",        dueDate: new Date(Date.now() + 3600000).toISOString(),    assignee: "You",        createdAt: new Date().toISOString() },
  { id: "7", title: "Intro call with Globex CFO",                priority: "high",   status: "in_progress", dueDate: new Date(Date.now() + 86400000 * 3).toISOString(), assignee: "You",      linkedEntity: { type: "contact", name: "CFO Globex" }, createdAt: new Date().toISOString() },
];

const PRIORITY_CFG: Record<Priority, { label: string; cls: string }> = {
  high:   { label: "High",   cls: "bg-red-100 text-red-700" },
  medium: { label: "Medium", cls: "bg-yellow-100 text-yellow-700" },
  low:    { label: "Low",    cls: "bg-green-100 text-green-700" },
};

type Filter = "all" | "mine" | "overdue" | "done";

export default function TasksPage() {
  const [tasks, setTasks]     = useState<Task[]>(DEMO_TASKS);
  const [filter, setFilter]   = useState<Filter>("all");
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const now = Date.now();

  const filtered = tasks.filter((t) => {
    if (filter === "mine")    return t.assignee === "You";
    if (filter === "overdue") return t.status !== "done" && new Date(t.dueDate).getTime() < now;
    if (filter === "done")    return t.status === "done";
    return t.status !== "done";
  });

  const toggle = (id: string) =>
    setTasks((ts) =>
      ts.map((t) => t.id === id ? { ...t, status: t.status === "done" ? "open" : "done" } : t)
    );

  const addTask = () => {
    if (!newTitle.trim()) return;
    const t: Task = {
      id: Date.now().toString(),
      title: newTitle.trim(),
      priority: "medium",
      status: "open",
      dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
      assignee: "You",
      createdAt: new Date().toISOString(),
    };
    setTasks((ts) => [t, ...ts]);
    setNewTitle("");
    setShowForm(false);
  };

  const overdue = tasks.filter((t) => t.status !== "done" && new Date(t.dueDate).getTime() < now).length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Tasks</h1>
          {overdue > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {overdue} overdue
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Task
        </button>
      </div>

      {/* Quick-create form */}
      {showForm && (
        <div className="flex gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <input
            autoFocus
            type="text"
            placeholder="Task title…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button onClick={addTask} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
            Add
          </button>
          <button onClick={() => setShowForm(false)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
            Cancel
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["all", "mine", "overdue", "done"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f === "all" ? "Open" : f}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col gap-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-400" />
              <p className="text-muted-foreground">All caught up!</p>
            </div>
          ) : (
            filtered.map((task) => {
              const overdue = task.status !== "done" && new Date(task.dueDate).getTime() < now;
              return (
                <div
                  key={task.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/30",
                    task.status === "done" && "opacity-60"
                  )}
                >
                  {/* Checkbox */}
                  <button onClick={() => toggle(task.id)} className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary">
                    {task.status === "done"
                      ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                      : <Circle className="h-5 w-5" />
                    }
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium", task.status === "done" && "line-through text-muted-foreground")}>
                      {task.title}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {/* Due date */}
                      <span className={cn("flex items-center gap-1", overdue ? "text-red-600" : "")}>
                        <Clock className="h-3 w-3" />
                        {overdue ? "Overdue · " : "Due "}{formatRelativeTime(task.dueDate)}
                      </span>

                      {/* Assignee */}
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {task.assignee}
                      </span>

                      {/* Linked entity */}
                      {task.linkedEntity && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3" /> {task.linkedEntity.name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Priority */}
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", PRIORITY_CFG[task.priority].cls)}>
                    {PRIORITY_CFG[task.priority].label}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
