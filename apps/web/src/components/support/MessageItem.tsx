"use client";

import Link from "next/link";
import { User as UserIcon, Headset, StickyNote, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeliveryChip, type DeliveryJob } from "./DeliveryChip";

export interface Message {
  id: string;
  role: "user" | "agent" | "internal_note";
  body: string;
  attachmentUrls: string[];
  senderName: string;
  authorId: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface Props {
  message: Message;
  /** Delivery job for this message, if any. Only present for agent replies. */
  job?: DeliveryJob;
  onJobRetried: () => void;
}

export function MessageItem({ message, job, onJobRetried }: Props) {
  const style = STYLE[message.role];

  return (
    <div className={cn("rounded-lg border p-4", style.container)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", style.iconBg)}>
            <style.Icon className={cn("h-3 w-3", style.iconColor)} />
          </span>
          <span className="font-medium">{message.senderName}</span>
          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", style.badge)}>
            {style.label}
          </span>
          <span className="text-muted-foreground">
            {new Date(message.createdAt).toLocaleString()}
          </span>
        </div>
        {job && <DeliveryChip job={job} onRetried={onJobRetried} />}
      </div>

      <p className="whitespace-pre-wrap text-sm text-foreground">{message.body}</p>

      {message.attachmentUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.attachmentUrls.map((url) => (
            <Link
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
            >
              <Paperclip className="h-3 w-3" />
              <span className="max-w-[200px] truncate">{filenameFromUrl(url)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const STYLE = {
  user: {
    container: "border-border bg-card",
    iconBg:    "bg-blue-100",
    iconColor: "text-blue-600",
    Icon:      UserIcon,
    badge:     "bg-blue-50 text-blue-700",
    label:     "Customer",
  },
  agent: {
    container: "border-green-200 bg-green-50/40",
    iconBg:    "bg-green-100",
    iconColor: "text-green-700",
    Icon:      Headset,
    badge:     "bg-green-50 text-green-800",
    label:     "Agent",
  },
  internal_note: {
    // Visually distinct so internal notes can never be mistaken for a
    // public agent reply. Yellow is the "internal only" color used across
    // most helpdesks for the same reason.
    container: "border-amber-300 bg-amber-50",
    iconBg:    "bg-amber-100",
    iconColor: "text-amber-700",
    Icon:      StickyNote,
    badge:     "bg-amber-100 text-amber-800 border border-amber-300",
    label:     "Internal note",
  },
} as const;

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1] || url);
  } catch {
    return url;
  }
}
