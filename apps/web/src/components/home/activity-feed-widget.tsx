import { Mail, Phone, Video, FileText } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

const ACTIVITY_ICONS = {
  email: Mail,
  call: Phone,
  meeting: Video,
  note: FileText,
} as const;

const MOCK_ACTIVITIES = [
  {
    id: "1",
    type: "email" as const,
    summary: "Re: Q1 proposal — Acme Corp",
    contact: "Sarah Chen",
    timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    source: "auto",
  },
  {
    id: "2",
    type: "meeting" as const,
    summary: "Discovery call — TechStart",
    contact: "Marcus Webb",
    timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    source: "auto",
  },
  {
    id: "3",
    type: "call" as const,
    summary: "Follow-up on legal concerns",
    contact: "Jennifer Park",
    timestamp: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    source: "auto",
  },
  {
    id: "4",
    type: "email" as const,
    summary: "Budget approval update",
    contact: "David Kim",
    timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    source: "auto",
  },
];

export async function ActivityFeedWidget() {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Recent Activity</h3>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          Auto-captured
        </span>
      </div>

      <div className="space-y-3">
        {MOCK_ACTIVITIES.map((activity) => {
          const Icon = ACTIVITY_ICONS[activity.type];
          return (
            <div key={activity.id} className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{activity.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {activity.contact} · {formatRelativeTime(activity.timestamp)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
