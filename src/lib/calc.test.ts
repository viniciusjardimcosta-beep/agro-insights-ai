import { describe, expect, it } from "vitest";
import {
  aggregateFarm,
  cropsMissingPrice,
  weightedCostPerHa,
  fieldMetrics,
  latestPriceByCrop,
  type CostRow,
  type FieldRow,
  type PriceRow,
} from "@/lib/calc";
import { fetchAll, isIsoDate, PAGE_SIZE } from "@/lib/db-utils";

// Mesmos números da fazenda de demonstração (src/lib/demo.functions.ts).
const soja: FieldRow = { id: "f1", name: "Talhão 1", area: 20, crop: "soja", estimated_yield: 65, real_yield: null };
const milho: FieldRow = { id: "f2", name: "Talhão 2", area: 15, crop: "milho", estimated_yield: 180, real_yield: null };
const costs: CostRow[] = [
  ...[18000, 32000, 14000, 8000, 22000, 9000].map((amount) => ({ field_id: "f1", category: "x", amount })),
  ...[11000, 21000, 9000, 6500, 4000, 6500].map((amount) => ({ field_id: "f2", category: "x", amount })),
];
const prices: PriceRow[] = [
  { crop: "soja", price_per_bag: 125, date: "2026-01-10" },
  { crop: "milho", price_per_bag: 60, date: "2026-01-10" },
];

describe("latestPriceByCrop", () => {
  it("usa o preço de data mais recente", () => {
    const out = latestPriceByCrop([
      { crop: "soja", price_per_bag: 100, date: "2026-01-01" },
      { crop: "soja", price_per_bag: 130, date: "2026-03-01" },
      { crop: "soja", price_per_bag: 110, date: "2026-02-01" },
    ]);
    expect(out.soja).toBe(130);
  });

  it("empate de data: vence o criado por último, em qualquer ordem de entrada", () => {
    const a = { crop: "soja", price_per_bag: 100, date: "2026-03-01", created_at: "2026-03-01T08:00:00Z" };
    const b = { crop: "soja", price_per_bag: 120, date: "2026-03-01", created_at: "2026-03-01T09:00:00Z" };
    expect(latestPriceByCrop([a, b]).soja).toBe(120);
    expect(latestPriceByCrop([b, a]).soja).toBe(120);
  });
});

describe("fieldMetrics / aggregateFarm (fazenda de demonstração)", () => {
  it("calcula receita, custo e lucro por talhão", () => {
    const m = fieldMetrics(soja, costs, { soja: 125 });
    expect(m.totalCost).toBe(103000);
    expect(m.revenue).toBe(20 * 65 * 125);
    expect(m.profit).toBe(162500 - 103000);
    const n = fieldMetrics(milho, costs, { milho: 60 });
    expect(n.totalCost).toBe(58000);
    expect(n.revenue).toBe(15 * 180 * 60);
  });

  it("agrega a fazenda inteira", () => {
    const farm = aggregateFarm([soja, milho], costs, prices);
    expect(farm.totalArea).toBe(35);
    expect(farm.totalCost).toBe(161000);
    expect(farm.totalRevenue).toBe(162500 + 162000);
    expect(farm.totalProfit).toBe(324500 - 161000);
  });

  it("área zero não gera divisão por zero", () => {
    const m = fieldMetrics({ ...soja, area: 0 }, costs, { soja: 125 });
    expect(m.costPerHa).toBe(0);
    expect(m.profitPerHa).toBe(0);
  });
});

describe("cropsMissingPrice", () => {
  it("lista culturas com talhão e sem preço, sem repetir", () => {
    expect(cropsMissingPrice([soja, milho, { crop: "milho" }], { soja: 125 })).toEqual(["milho"]);
    expect(cropsMissingPrice([soja], { soja: 125 })).toEqual([]);
  });
});

describe("isIsoDate", () => {
  it("aceita datas reais e rejeita inválidas", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("31/01/2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});

describe("fetchAll", () => {
  it("busca todas as páginas (mais de 1000 linhas)", async () => {
    const total = PAGE_SIZE * 2 + 37;
    const rows = Array.from({ length: total }, (_, i) => i);
    const out = await fetchAll<number>(async (from, to) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));
    expect(out).toHaveLength(total);
  });

  it("devolve erro genérico, sem vazar a mensagem do banco", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      await expect(
        fetchAll(async () => ({ data: null, error: { message: 'relation "costs" does not exist' } })),
      ).rejects.toThrow(/Não foi possível concluir/);
    } finally {
      console.error = quiet;
    }
  });
});

describe("weightedCostPerHa", () => {
  it("pondera pela área (fazenda de demonstração: 161.000 ÷ 35 ha)", () => {
    const farm = aggregateFarm([soja, milho], costs, prices);
    expect(weightedCostPerHa(farm.perField)).toBeCloseTo(161000 / 35, 6);
  });

  it("difere da média simples quando as áreas são diferentes", () => {
    const perField = [
      { area: 20, totalCost: 117000 }, // 5.850/ha
      { area: 15, totalCost: 54000 }, // 3.600/ha
    ];
    const weighted = weightedCostPerHa(perField);
    expect(weighted).toBeCloseTo(171000 / 35, 6); // ≈ 4.885,71
    const over = ((5850 - weighted) / weighted) * 100;
    expect(over < 20).toBe(true); // ≈ +19,7% (média simples daria +23,8%)
  });

  it("ignora talhões sem área e não divide por zero", () => {
    expect(weightedCostPerHa([{ area: 0, totalCost: 500 }])).toBe(0);
    expect(weightedCostPerHa([])).toBe(0);
    expect(weightedCostPerHa([{ area: 10, totalCost: 1000 }, { area: 0, totalCost: 999 }])).toBe(100);
  });
});
