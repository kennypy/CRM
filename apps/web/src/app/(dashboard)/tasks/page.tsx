"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { formatRelativeTime, cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  CheckSquare, Plus, AlertCircle, Clock, CheckCircle2,
  Circle, Briefcase, Users, ChevronDown, X, Search,
} from "lucide-react";

type Priority = "high" | "medium" | "low";
type Status   = "open" | "in_progress" | "done";

interface LinkedEntity { type: "deal" | "contact" | "company"; id: string; name: string; }

interface Task {
  id: string;
  title: string;
  priority: Priority;
  status: Status;
  dueDate: string;
  assignee: string;
  linkedEntity?: LinkedEntity;
  createdAt: string;
}

const DEMO_TASKS: Task[] = [
  { id: "1", title: "Follow up with Acme Corp legal team",    priority: "high",   status: "open",        dueDate: new Date(Date.now() - 86400000).toISOString(),      assignee: "You", linkedEntity: { type: "deal",    id: "d1", name: "Acme Enterprise"  }, createdAt: new Date().toISOString() },
  { id: "2", title: "Send proposal to TechStart",             priority: "high",   status: "in_progress", dueDate: new Date(Date.now() + 86400000).toISOString(),      assignee: "You", linkedEntity: { type: "deal",    id: "d2", name: "TechStart Growth" }, createdAt: new Date().toISOString() },
  { id: "3", title: "Schedule demo with Globex stakeholders", priority: "medium", status: "open",        dueDate: new Date(Date.now() + 172800000).toISOString(),     assignee: "Sarah Kim", linkedEntity: { type: "contact", id: "c1", name: "John Globex"      }, createdAt: new Date().toISOString() },
  { id: "4", title: "Update CRM notes after Acme call",       priority: "low",    status: "done",        dueDate: new Date(Date.now() - 172800000).toISOString(),     assignee: "You", linkedEntity: { type: "deal",    id: "d1", name: "Acme Enterprise"  }, createdAt: new Date().toISOString() },
  { id: "5", title: "Prepare Q1 pipeline review deck",        priority: "medium", status: "open",        dueDate: new Date(Date.now() + 432000000).toISOString(),     assignee: "You",                                                                         createdAt: new Date().toISOString() },
  { id: "6", title: "Review and approve 7 AI extractions",    priority: "high",   status: "open",        dueDate: new Date(Date.now() + 3600000).toISOString(),       assignee: "You",                                                                         createdAt: new Date().toISOString() },
  { id: "7", title: "Intro call with Globex CFO",             priority: "high",   status: "in_progress", dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),  assignee: "You", linkedEntity: { type: "contact", id: "c2", name: "CFO Globex"      }, createdAt: new Date().toISOString() },
];

const PRIORITY_CFG: Record<Priority, { label: string; labelKey: string; cls: string }> = {
  high:   { label: "High",   labelKey: "high",   cls: "bg-red-100 text-red-700"    },
  medium: { label: "Medium", labelKey: "medium", cls: "bg-yellow-100 text-yellow-700" },
  low:    { label: "Low",    labelKey: "low",    cls: "bg-green-100 text-green-700" },
};

// ── Linked entity search ──────────────────────────────────────────────────────

function EntitySearch({ value, onChange }: {
  value: LinkedEntity | null;
  onChange: (v: LinkedEntity | null) => void;
}) {
  const t = useTranslations("tasks");
  const [search, setSearch]   = useState("");
  const [results, setResults] = useState<LinkedEntity[]>([]);
  const [open, setOpen]       = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    try {
      // Search contacts and companies in parallel
      const [cRes, coRes] = await Promise.all([
        api.get(`/api/v1/contacts?search=${encodeURIComponent(q)}&limit=4`),
        api.get(`/api/v1/companies?search=${encodeURIComponent(q)}&limit=3`),
      ]);
      const contacts  = cRes.ok  ? (await cRes.json()).data  ?? [] : [];
      const companies = coRes.ok ? (await coRes.json()).data ?? [] : [];
      setResults([
        ...contacts.map((c: any) => ({ type: "contact" as const, id: c.id, name: `${c.firstName} ${c.lastName}` })),
        ...companies.map((c: any) => ({ type: "company" as const, id: c.id, name: c.name })),
      ]);
      setOpen(true);
    } catch {}
  }, []);

  const handleChange = (v: string) => {
    setSearch(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(v), 300);
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
        <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate">{value.name}</span>
        <span className="text-xs text-muted-foreground capitalize">{value.type}</span>
        <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        value={search}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t("linkToContactPlaceholder")}
        className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-lg border bg-card shadow-lg overflow-hidden">
          {results.map((r) => (
            <button key={`${r.type}-${r.id}`} type="button"
              onClick={() => { onChange(r); setSearch(""); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left">
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium",
                r.type === "contact" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700")}>
                {r.type}
              </span>
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create Task Modal ─────────────────────────────────────────────────────────

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: (task: Task) => void }) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [title, setTitle]         = useState("");
  const [priority, setPriority]   = useState<Priority>("medium");
  const [dueDate, setDueDate]     = useState(new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10));
  const [linked, setLinked]       = useState<LinkedEntity | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);

    const payload = {
      title: title.trim(),
      priority,
      dueDate: new Date(dueDate).toISOString(),
      linkedEntityType: linked?.type,
      linkedEntityId:   linked?.id,
    };

    try {
      const res = await api.post("/api/v1/tasks", payload);
      if (res.ok) {
        const data = await res.json();
        onCreated(data.data ?? { ...payload, id: Date.now().toString(), status: "open", assignee: "You", createdAt: new Date().toISOString(), linkedEntity: linked ?? undefined });
        onClose();
        return;
      }
    } catch {
      // API may not exist yet — fall back to local state
    }

    // Local fallback
    onCreated({
      id: Date.now().toString(),
      title: title.trim(),
      priority,
      status: "open",
      dueDate: new Date(dueDate).toISOString(),
      assignee: "You",
      linkedEntity: linked ?? undefined,
      createdAt: new Date().toISOString(),
    });
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{t("newTask")}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("taskTitle")} *</label>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required
              placeholder={t("taskTitlePlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("priority")}</label>
              <div className="flex gap-1">
                {(["high", "medium", "low"] as Priority[]).map((p) => (
                  <button key={p} type="button" onClick={() => setPriority(p)}
                    className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-medium border capitalize transition-colors",
                      priority === p ? PRIORITY_CFG[p].cls + " border-current" : "border-border text-muted-foreground hover:bg-muted")}>
                    {t(PRIORITY_CFG[p].labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("dueDate")}</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("linkToContactOrAccount")}</label>
            <EntitySearch value={linked} onChange={setLinked} />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              {tc("cancel")}
            </button>
            <button type="submit" disabled={loading || !title.trim()}
              className={cn("flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                (loading || !title.trim()) ? "opacity-60 cursor-not-allowed" : "hover:opacity-90")}>
              {loading ? t("creating") : t("createTask")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Filter = "all" | "mine" | "overdue" | "done";

export default function TasksPage() {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<Filter>("all");
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    api.get("/api/v1/tasks")
      .then((r) => r.json())
      .then((json) => {
        const data: Task[] = (json.data ?? []).map((t: any) => ({
          id:           t.id,
          title:        t.title,
          priority:     t.priority ?? "medium",
          status:       t.status   ?? "open",
          dueDate:      t.dueDate  ?? t.due_date,
          assignee:     t.assignee ?? "You",
          linkedEntity: t.linkedEntity ?? (t.linked_entity_id ? { type: t.linked_entity_type, id: t.linked_entity_id, name: t.linked_entity_name ?? "" } : undefined),
          createdAt:    t.createdAt ?? t.created_at,
        }));
        setTasks(data);
      })
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);

  const now = Date.now();

  const filtered = tasks.filter((task) => {
    if (filter === "mine")    return task.assignee === "You";
    if (filter === "overdue") return task.status !== "done" && new Date(task.dueDate).getTime() < now;
    if (filter === "done")    return task.status === "done";
    return task.status !== "done";
  });

  const toggle = async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const newStatus: Status = task.status === "done" ? "open" : "done";
    setTasks((ts) => ts.map((t) => t.id === id ? { ...t, status: newStatus } : t));
    try {
      await api.patch(`/api/v1/tasks/${id}`, { status: newStatus });
    } catch {
      // revert on error
      setTasks((ts) => ts.map((t) => t.id === id ? { ...t, status: task.status } : t));
    }
  };

  const overdue = tasks.filter((task) => task.status !== "done" && new Date(task.dueDate).getTime() < now).length;

  const FILTER_LABELS: Record<Filter, string> = {
    all:     t("filterOpen"),
    mine:    t("filterMine"),
    overdue: t("overdue"),
    done:    t("completed"),
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          {overdue > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {t("overdueCount", { count: overdue })}
            </span>
          )}
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> {t("newTask")}
        </button>
      </div>

      {showModal && (
        <CreateTaskModal
          onClose={() => setShowModal(false)}
          onCreated={(task) => setTasks((ts) => [task, ...ts])}
        />
      )}

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["all", "mine", "overdue", "done"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex flex-col gap-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">{t("loadingTasks")}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-400" />
              <p className="text-muted-foreground">{t("allCaughtUp")}</p>
            </div>
          ) : null}
          {!loading && filtered.length > 0 && (
            filtered.map((task) => {
              const isOverdue = task.status !== "done" && new Date(task.dueDate).getTime() < now;
              return (
                <div key={task.id}
                  className={cn("flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/30",
                    task.status === "done" && "opacity-60")}>
                  <button onClick={() => toggle(task.id)} className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
                    title={task.status === "done" ? t("markIncomplete") : t("markComplete")}>
                    {task.status === "done"
                      ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                      : <Circle className="h-5 w-5" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium", task.status === "done" && "line-through text-muted-foreground")}>
                      {task.title}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn("flex items-center gap-1", isOverdue ? "text-red-600" : "")}>
                        <Clock className="h-3 w-3" />
                        {isOverdue ? `${t("overdue")} · ` : `${t("due")} `}{formatRelativeTime(task.dueDate)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {task.assignee}
                      </span>
                      {task.linkedEntity && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3" /> {task.linkedEntity.name}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", PRIORITY_CFG[task.priority].cls)}>
                    {t(PRIORITY_CFG[task.priority].labelKey)}
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
