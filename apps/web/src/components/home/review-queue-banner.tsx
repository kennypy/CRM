import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";

// In production: fetch from API
async function getReviewQueueCount(): Promise<number> {
  return 7; // mock
}

export async function ReviewQueueBanner() {
  const count = await getReviewQueueCount();
  if (count === 0) return null;

  return (
    <Link
      href="/review"
      className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 transition-colors hover:bg-warning/10"
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-warning" />
        <span className="text-sm font-medium">
          {count} AI extractions need your review
        </span>
        <span className="text-xs text-muted-foreground">
          — low confidence, 1-click to approve
        </span>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}
