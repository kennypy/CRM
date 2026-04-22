"use client";

import { MessageItem, type Message } from "./MessageItem";
import type { DeliveryJob } from "./DeliveryChip";

interface Props {
  messages: Message[];
  jobs: DeliveryJob[];
  onJobRetried: () => void;
}

export function MessageThread({ messages, jobs, onJobRetried }: Props) {
  // Pre-index jobs by message_id so each agent message renders the latest
  // delivery state without an O(n) scan inside the render loop. Sort by
  // updatedAt so a retried dead-letter job replaces the old chip.
  const jobByMessage = new Map<string, DeliveryJob>();
  const sorted = [...jobs].sort((a, b) =>
    new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
  );
  for (const j of sorted) {
    if (j.messageId) jobByMessage.set(j.messageId, j);
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => (
        <MessageItem
          key={m.id}
          message={m}
          job={jobByMessage.get(m.id)}
          onJobRetried={onJobRetried}
        />
      ))}
    </div>
  );
}
