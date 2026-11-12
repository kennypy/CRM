import { describe, expect, it } from "vitest";
import { heuristicForecast } from "../routes/forecasting";

const NOW = Date.parse("2026-06-15T00:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe("heuristicForecast", () => {
  it("uses the stage baseline for a fresh opportunity", () => {
    const f = heuristicForecast({ id: "d", stage: "negotiation", value: 50000, closeDate: day(30), updatedAt: day(-1) }, NOW);
    expect(f.probability).toBe(70);
    expect(f.predictedValue).toBe(35000);
    expect([f.low, f.high]).toEqual([55, 85]);
  });

  it("penalises staleness and an overdue close date, and explains why", () => {
    const f = heuristicForecast({ id: "d", stage: "proposal", value: 1000, closeDate: day(-10), updatedAt: day(-65) }, NOW);
    expect(f.probability).toBe(15); // 50 - 20 - 15
    expect(f.factors.map((x) => x.factor)).toEqual(["stage", "staleness", "overdue"]);
    expect(f.factors.reduce((a, x) => a + x.points, 0)).toBe(15);
  });

  it("blends the rep's declared probability at half weight (0-1 or 0-100)", () => {
    expect(heuristicForecast({ id: "d", stage: "discovery", declaredProbability: 0.9 }, NOW).probability).toBe(60);
    expect(heuristicForecast({ id: "d", stage: "discovery", declaredProbability: 90 }, NOW).probability).toBe(60);
  });

  it("stays within 1-95 and tolerates missing fields", () => {
    const f = heuristicForecast({ id: "d", stage: "lead", closeDate: day(-400), updatedAt: day(-400) }, NOW);
    expect(f.probability).toBe(1);
    expect(f.predictedValue).toBeNull();
    expect(heuristicForecast({ id: "d" }, NOW).probability).toBe(25);
  });
});
