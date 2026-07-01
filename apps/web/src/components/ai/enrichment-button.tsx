"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";

interface EnrichmentButtonProps {
  entityType: "contact" | "company";
  entityId: string;
  onEnriched?: (fields: string[]) => void;
}

export function EnrichmentButton({ entityType, entityId, onEnriched }: EnrichmentButtonProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ fields: string[]; confidence: number } | null>(null);

  const enrich = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/api/v1/ai/enrich/${entityType}/${entityId}`, {});
      if (!res.ok) throw new Error(`Enrichment failed (${res.status})`);
      const json = await res.json();
      setResult({
        fields: json.data?.enrichedFields ?? [],
        confidence: json.data?.confidence ?? 0,
      });
      onEnriched?.(json.data?.enrichedFields ?? []);
    } catch (e: any) {
      alert(`Enrichment failed: ${e.message}`);
    }
    setLoading(false);
  };

  if (result) {
    return (
      <div className="flex items-center gap-1 text-xs text-green-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Enriched {result.fields.length} field{result.fields.length !== 1 ? "s" : ""}</span>
      </div>
    );
  }

  return (
    <button onClick={enrich} disabled={loading}
      className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary transition-colors disabled:opacity-50">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {loading ? "Enriching..." : "Enrich"}
    </button>
  );
}
