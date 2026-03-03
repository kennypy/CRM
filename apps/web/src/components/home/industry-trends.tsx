import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface IndustryTrend {
  industry: string;
  direction: "up" | "down" | "flat";
  change: number;           // percentage points
  dealVelocity: string;     // "high" | "medium" | "low"
  insight: string;
  signalCount: number;
}

// In production, fetch from AI engine trend analysis
const MOCK_TRENDS: IndustryTrend[] = [
  {
    industry: "SaaS / Cloud",
    direction: "up",
    change: 18,
    dealVelocity: "high",
    insight: "Budget cycles accelerating into Q2. Buyers prioritising AI-native tooling.",
    signalCount: 24,
  },
  {
    industry: "Financial Services",
    direction: "up",
    change: 11,
    dealVelocity: "high",
    insight: "Regulatory compliance spend driving new evaluation cycles for automation.",
    signalCount: 17,
  },
  {
    industry: "Healthcare",
    direction: "flat",
    change: 2,
    dealVelocity: "medium",
    insight: "Procurement slowdown due to fiscal year resets. Activity expected to resume in 6 weeks.",
    signalCount: 9,
  },
  {
    industry: "Manufacturing",
    direction: "down",
    change: -8,
    dealVelocity: "low",
    insight: "Supply-chain uncertainty causing deal delays. Focus retention over expansion.",
    signalCount: 5,
  },
  {
    industry: "Retail & E-commerce",
    direction: "up",
    change: 6,
    dealVelocity: "medium",
    insight: "Post-holiday consolidation phase. Loyalty and CX spend increasing.",
    signalCount: 12,
  },
];

const VELOCITY_STYLES: Record<string, string> = {
  high:   "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  low:    "bg-red-100 text-red-700",
};

export async function IndustryTrends() {
  const trends = MOCK_TRENDS;

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Industry Trends</h3>
        <span className="text-xs text-muted-foreground">Last 30 days · AI-analysed</span>
      </div>

      <div className="space-y-3">
        {trends.map((t) => (
          <div key={t.industry} className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {t.direction === "up" ? (
                  <TrendingUp className="h-4 w-4 shrink-0 text-green-600" />
                ) : t.direction === "down" ? (
                  <TrendingDown className="h-4 w-4 shrink-0 text-red-500" />
                ) : (
                  <Minus className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm font-medium">{t.industry}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn(
                  "text-xs font-semibold tabular-nums",
                  t.direction === "up" ? "text-green-600" :
                  t.direction === "down" ? "text-red-500" : "text-muted-foreground"
                )}>
                  {t.direction === "up" ? "+" : ""}{t.change}%
                </span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  VELOCITY_STYLES[t.dealVelocity]
                )}>
                  {t.dealVelocity}
                </span>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{t.insight}</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{t.signalCount} signals</p>
          </div>
        ))}
      </div>
    </div>
  );
}
