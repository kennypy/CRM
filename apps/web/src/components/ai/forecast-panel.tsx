"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { TrendingUp, RefreshCw, Loader2 } from "lucide-react";

interface ForecastData {
  period: string;
  pipeline: {
    stages: Array<{ stage: string; count: number; value: number }>;
    winRate: number;
    avgVelocityDays: number;
    recentRevenue30d: number;
  };
  narrative: string;
  createdAt: string;
}

export function ForecastPanel() {
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/api/v1/ai/forecast?period=quarter");
      setForecast(res.data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load forecast");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">AI Forecast</h3>
        </div>
        <button onClick={load} disabled={loading}
          className="text-muted-foreground hover:text-foreground">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading && !forecast && (
        <div className="h-24 rounded-lg bg-muted animate-pulse" />
      )}

      {forecast && (
        <div className="space-y-4">
          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-lg font-semibold">{forecast.pipeline.winRate}%</p>
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{Math.round(forecast.pipeline.avgVelocityDays)}d</p>
              <p className="text-xs text-muted-foreground">Avg Velocity</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">${(forecast.pipeline.recentRevenue30d / 1000).toFixed(0)}k</p>
              <p className="text-xs text-muted-foreground">Revenue 30d</p>
            </div>
          </div>

          {/* AI Narrative */}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-sm leading-relaxed">{forecast.narrative}</p>
          </div>

          <p className="text-xs text-muted-foreground text-right">
            Updated {new Date(forecast.createdAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
