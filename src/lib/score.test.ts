import { describe, expect, it } from "vitest";
import { aggregateFarm } from "./calc";
import { computeScoreBreakdown } from "./score";

const field = (id: string, crop: string, area: number, extra: Record<string, unknown> = {}) => ({ id, name: id, crop, area, estimated_yield: 60, property_id: "p", ...extra });

describe("nota de saúde financeira", () => {
  it("talhão sem preço não é punido várias vezes pela mesma falta", () => {
    const fields = [field("Milho", "Milho", 100), field("Soja", "Soja", 60)];
    const costs = [{ field_id: "Milho", amount: 5000, category: "Diesel" }, { field_id: "Soja", amount: 100, category: "Diesel" }];
    const prices = [{ crop: "Milho", price_per_bag: 60, date: "2026-01-01", created_at: "2026-01-01" }];
    const farm = aggregateFarm(fields as never, costs as never, prices as never);
    const { score, breakdown } = computeScoreBreakdown(farm);
    const labels = breakdown.map((b) => b.label).join(" | ");
    expect(labels.includes("Falta de preço cadastrado (Soja)")).toBe(true);
    expect(labels.includes("Talhões com lucro negativo")).toBe(false);
    expect(labels.includes("Diferença de rentabilidade")).toBe(false);
    expect(score > 50).toBe(true);
  });
});
