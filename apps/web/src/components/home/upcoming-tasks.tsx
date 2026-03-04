import Link from "next/link";
import { CheckSquare, Clock, ArrowRight } from "lucide-react";

const UPCOMING = [
  { id: "1", title: "Follow up with Acme Corp legal team",    priority: "high",   dueLabel: "Overdue",      overdue: true,  href: "/tasks" },
  { id: "2", title: "Send proposal to TechStart",             priority: "high",   dueLabel: "Due tomorrow", overdue: false, href: "/tasks" },
  { id: "3", title: "Review and approve 7 AI extractions",    priority: "high",   dueLabel: "Due in 1h",    overdue: false, href: "/review" },
  { id: "5", title: "Schedule demo with Globex stakeholders", priority: "medium", dueLabel: "Due in 2 days",overdue: false, href: "/tasks" },
];

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-red-500",
  medium: "bg-yellow-500",
  low:    "bg-green-500",
};

export async function UpcomingTasks() {
  const overdue = UPCOMING.filter((t) => t.overdue).length;

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Upcoming Tasks</h3>
          {overdue > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {overdue} overdue
            </span>
          )}
        </div>
        <Link href="/tasks" className="flex items-center gap-1 text-xs text-primary hover:underline">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-2">
        {UPCOMING.map((task) => (
          <Link key={task.id} href={task.href}
            className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/50 transition-colors group">
            <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} />
            <p className="flex-1 text-sm truncate group-hover:text-primary transition-colors">{task.title}</p>
            <span className={`flex items-center gap-1 text-xs shrink-0 ${task.overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
              <Clock className="h-3 w-3" />
              {task.dueLabel}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
