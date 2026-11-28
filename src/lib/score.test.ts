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

describe("nota: uma regra por talhão (Etapa 17)", () => {
  const prices = [
    { crop: "Milho", price_per_bag: 60, date: "2026-01-01", created_at: "2026-01-01" },
    { crop: "Trigo", price_per_bag: 100, date: "2026-01-01", created_at: "2026-01-01" },
  ];
  const build = () => {
    const fields = [
      field("M1", "Milho", 100),
      field("Tr", "Trigo", 100),
      field("T4", "Trigo", 10, { estimated_yield: 20 }),
      field("Sj", "Soja", 50),
    ];
    const costs = [
      { field_id: "M1", amount: 2000, category: "Diesel" },
      { field_id: "Tr", amount: 3000, category: "Diesel" },
      { field_id: "T4", amount: 90000, category: "Diesel" },
      { field_id: "Sj", amount: 500, category: "Diesel" },
    ];
    return aggregateFarm(fields as never, costs as never, prices as never);
  };

  it("talhão em prejuízo perde pontos só por lucro negativo; o resto vira observação", () => {
    const { breakdown } = computeScoreBreakdown(build());
    const neg = breakdown.filter((b) => b.label.startsWith("Talhões com lucro negativo"));
    expect(neg.length).toBe(1);
    expect(neg[0].points).toBe(-25);
    const penaltyLabels = breakdown.filter((b) => b.points < 0).map((b) => b.label).join(" | ");
    expect(penaltyLabels.includes("Custo/ha")).toBe(false);
    expect(penaltyLabels.includes("Ponto de equilíbrio")).toBe(false);
    expect(breakdown.some((b) => b.points === 0 && b.label.startsWith("Observação"))).toBe(true);
  });

  it("mostra talhões sem preço fora do cálculo, sem linha de piso", () => {
    const { breakdown } = computeScoreBreakdown(build());
    expect(breakdown.some((b) => b.label.startsWith("Talhões sem preço não entraram no cálculo: Sj"))).toBe(true);
    expect(breakdown.some((b) => b.label.startsWith("Ajuste para"))).toBe(false);
  });

  it("margem alta não fica abaixo de uma fazenda com margem negativa", () => {
    const good = computeScoreBreakdown(build()).score;
    const badFields = [field("A", "Milho", 100)];
    const badCosts = [{ field_id: "A", amount: 900000, category: "Diesel" }];
    const bad = computeScoreBreakdown(
      aggregateFarm(badFields as never, badCosts as never, prices as never),
    ).score;
    expect(good > bad).toBe(true);
  });

  it("dependência só vale com 2+ culturas lucrativas", () => {
    const fields = [field("M1", "Milho", 100), field("Tr", "Trigo", 10, { estimated_yield: 20 })];
    const costs = [
      { field_id: "M1", amount: 2000, category: "Diesel" },
      { field_id: "Tr", amount: 90000, category: "Diesel" },
    ];
    const { breakdown } = computeScoreBreakdown(
      aggregateFarm(fields as never, costs as never, prices as never),
    );
    expect(breakdown.some((b) => b.label.startsWith("Dependência da cultura"))).toBe(false);
  });
});
