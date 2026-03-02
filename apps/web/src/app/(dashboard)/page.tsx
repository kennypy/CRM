import { Suspense } from "react";
import { IntelligenceBrief } from "@/components/home/intelligence-brief";
import { PipelineSnapshot } from "@/components/home/pipeline-snapshot";
import { ReviewQueueBanner } from "@/components/home/review-queue-banner";
import { ActivityFeedWidget } from "@/components/home/activity-feed-widget";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = { title: "Home — NexCRM" };

export default function HomePage() {
  return (
    <div className="space-y-6">
      {/* AI-generated daily brief */}
      <Suspense fallback={<Skeleton className="h-32 w-full rounded-xl" />}>
        <IntelligenceBrief />
      </Suspense>

      {/* Review queue alert — shows when AI has low-confidence items */}
      <Suspense fallback={null}>
        <ReviewQueueBanner />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pipeline snapshot */}
        <div className="lg:col-span-2">
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <PipelineSnapshot />
          </Suspense>
        </div>

        {/* Activity feed */}
        <div>
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <ActivityFeedWidget />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
