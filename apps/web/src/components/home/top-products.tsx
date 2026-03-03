import { cn, formatCurrency } from "@/lib/utils";
import { Package, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface ProductSegmentStat {
  product: string;
  segment: "Enterprise" | "SMB" | "Startup";
  revenue: number;
  dealCount: number;
  winRate: number;       // 0–100
  growth: number;        // % change vs prior period
}

// In production, derive from closed-won deals grouped by product + company.plan
const MOCK_STATS: ProductSegmentStat[] = [
  {
    product: "Platform Pro",
    segment: "Enterprise",
    revenue: 1_240_000,
    dealCount: 8,
    winRate: 68,
    growth: 22,
  },
  {
    product: "Platform Pro",
    segment: "SMB",
    revenue: 580_000,
    dealCount: 24,
    winRate: 54,
    growth: 9,
  },
  {
    product: "Analytics Add-on",
    segment: "Enterprise",
    revenue: 420_000,
    dealCount: 11,
    winRate: 72,
    growth: 31,
  },
  {
    product: "Starter",
    segment: "Startup",
    revenue: 195_000,
    dealCount: 39,
    winRate: 41,
    growth: -4,
  },
  {
    product: "Analytics Add-on",
    segment: "SMB",
    revenue: 175_000,
    dealCount: 18,
    winRate: 49,
    growth: 14,
  },
  {
    product: "Support Tier",
    segment: "Enterprise",
    revenue: 310_000,
    dealCount: 6,
    winRate: 83,
    growth: 5,
  },
];

const SEGMENT_STYLES: Record<string, string> = {
  Enterprise: "bg-purple-100 text-purple-700",
  SMB:        "bg-blue-100 text-blue-700",
  Startup:    "bg-green-100 text-green-700",
};

export async function TopProducts() {
  const stats = MOCK_STATS.sort((a, b) => b.revenue - a.revenue);
  const maxRevenue = stats[0]?.revenue ?? 1;

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Top Products by Segment</h3>
        </div>
        <span className="text-xs text-muted-foreground">Closed Won · 90 days</span>
      </div>

      <div className="space-y-3">
        {stats.map((s, i) => (
          <div key={`${s.product}-${s.segment}`} className="flex items-center gap-3">
            {/* Rank */}
            <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>

            {/* Bar + labels */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-sm font-medium">{s.product}</span>
                  <span className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium",
                    SEGMENT_STYLES[s.segment]
                  )}>
                    {s.segment}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <span className="font-medium tabular-nums">
                    {formatCurrency(s.revenue, "USD", true)}
                  </span>
                  <span className={cn(
                    "flex items-center gap-0.5 font-medium tabular-nums",
                    s.growth >= 0 ? "text-green-600" : "text-red-500"
                  )}>
                    {s.growth >= 0
                      ? <ArrowUpRight className="h-3 w-3" />
                      : <ArrowDownRight className="h-3 w-3" />
                    }
                    {Math.abs(s.growth)}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60 transition-all"
                  style={{ width: `${(s.revenue / maxRevenue) * 100}%` }}
                />
              </div>
              <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{s.dealCount} deals</span>
                <span>{s.winRate}% win rate</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
