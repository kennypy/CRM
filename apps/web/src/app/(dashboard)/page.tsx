import { Suspense } from "react";
import Link from "next/link";
import { IntelligenceBrief } from "@/components/home/intelligence-brief";
import { PipelineSnapshot } from "@/components/home/pipeline-snapshot";
import { ReviewQueueBanner } from "@/components/home/review-queue-banner";
import { ActivityFeedWidget } from "@/components/home/activity-feed-widget";
import { IndustryTrends } from "@/components/home/industry-trends";
import { TopProducts } from "@/components/home/top-products";
import { UpcomingTasks } from "@/components/home/upcoming-tasks";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = { title: "Home — NexCRM" };

export default function HomePage() {
  return (
    <div className="space-y-6">
      {/* AI-generated daily brief */}
      <Suspense fallback={<Skeleton className="h-32 w-full rounded-xl" />}>
        <IntelligenceBrief />
      </Suspense>

      {/* Review queue alert */}
      <Suspense fallback={null}>
        <ReviewQueueBanner />
      </Suspense>

      {/* Pipeline + Activity + Upcoming Tasks row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <PipelineSnapshot />
          </Suspense>
        </div>
        <div className="flex flex-col gap-6">
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <ActivityFeedWidget />
          </Suspense>
        </div>
      </div>

      {/* Upcoming Tasks widget — full width */}
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <UpcomingTasks />
      </Suspense>

      {/* Industry Trends + Top Products */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
          <IndustryTrends />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
          <TopProducts />
        </Suspense>
      </div>
    </div>
  );
}
