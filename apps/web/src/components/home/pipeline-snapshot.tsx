import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const MOCK_PIPELINE = [
  { stage: "Qualified",   count: 12, value: 480000, color: "bg-blue-400"   },
  { stage: "Discovery",   count: 8,  value: 320000, color: "bg-indigo-400" },
  { stage: "Proposal",    count: 5,  value: 290000, color: "bg-violet-400" },
  { stage: "Negotiation", count: 3,  value: 210000, color: "bg-purple-500" },
  { stage: "Closed Won",  count: 2,  value: 140000, color: "bg-green-500"  },
];

interface Props {
  currency?: string;
  locale?:   string;
}

export async function PipelineSnapshot({ currency = "USD", locale = "en-US" }: Props) {
  const totalValue = MOCK_PIPELINE.reduce((sum, s) => sum + s.value, 0);
  const maxValue   = Math.max(...MOCK_PIPELINE.map((s) => s.value));

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Pipeline Snapshot</h3>
        <Link href="/pipeline" className="flex items-center gap-1 text-xs text-primary hover:underline">
          View pipeline <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {formatCurrency(totalValue, currency, true, locale)} total across {MOCK_PIPELINE.reduce((s, p) => s + p.count, 0)} deals
      </p>

      <div className="space-y-3">
        {MOCK_PIPELINE.map((stage) => (
          <Link key={stage.stage} href="/pipeline"
            className="flex items-center gap-3 rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors group">
            <span className="w-24 shrink-0 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              {stage.stage}
            </span>
            <div className="flex-1 overflow-hidden rounded-full bg-muted">
              <div className={`h-2 rounded-full ${stage.color} transition-all`}
                style={{ width: `${(stage.value / maxValue) * 100}%` }} />
            </div>
            <span className="w-16 text-right text-sm font-medium">
              {formatCurrency(stage.value, currency, true, locale)}
            </span>
            <span className="w-6 text-right text-xs text-muted-foreground">{stage.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
