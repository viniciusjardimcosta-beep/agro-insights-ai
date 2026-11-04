import { describe, expect, it } from "vitest";
import { aggregateFarm, type CostRow, type FieldRow, type PriceRow } from "@/lib/calc";
import { buildFacts, factualItems, reconcileText, sanitizeItems } from "@/lib/report-facts";

// Fazenda de teste do relatório real: custo R$ 171.000, receita R$ 324.500.
const fields: FieldRow[] = [
  { id: "f1", name: "Talhão 1", area: 20, crop: "soja", estimated_yield: 65, real_yield: null },
  { id: "f2", name: "Talhão 2", area: 15, crop: "milho", estimated_yield: 180, real_yield: null },
];
const costs: CostRow[] = [
  { field_id: "f1", category: "Sementes", amount: 28000 },
  { field_id: "f1", category: "Fertilizantes", amount: 32000 },
  { field_id: "f1", category: "Outros", amount: 57000 },
  { field_id: "f2", category: "Sementes", amount: 11000 },
  { field_id: "f2", category: "Fertilizantes", amount: 21000 },
  { field_id: "f2", category: "Outros", amount: 22000 },
];
const prices: PriceRow[] = [
  { crop: "soja", price_per_bag: 125, date: "2026-01-10" },
  { crop: "milho", price_per_bag: 60, date: "2026-01-10" },
];
const farm = aggregateFarm(fields, costs, prices);
const facts = buildFacts(farm, costs);

describe("reconcileText", () => {
  it("mantém números corretos", () => {
    const t = "Custo da soja (R$ 5.850,00) está 19,7% acima da média da fazenda (R$ 4.885,71).";
    const r = reconcileText(t, facts);
    expect(r.ok).toBe(true);
    expect(r.text).toBe(t);
  });

  it("corrige arredondamento errado da IA (19,8% -> 19,7%)", () => {
    const r = reconcileText("A soja está 19,8% acima da média.", facts);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("A soja está 19,7% acima da média.");
  });

  it("corrige 70.3% para 70,4% do lucro", () => {
    const r = reconcileText("O milho gera 70.3% do lucro total.", facts);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("O milho gera 70,4% do lucro total.");
  });

  it("aceita inteiros que conferem (57% da área, 216% de diferença)", () => {
    expect(reconcileText("A soja ocupa 57% da área.", facts).ok).toBe(true);
    expect(reconcileText("Lucro/ha 216% superior à soja.", facts).ok).toBe(true);
  });

  it("rejeita percentual inventado", () => {
    expect(reconcileText("Queda de 42% no preço do milho.", facts).ok).toBe(false);
  });

  it("rejeita valor em R$ inventado, mas aceita o real", () => {
    expect(reconcileText("Economia de R$ 90.000 possível.", facts).ok).toBe(false);
    expect(reconcileText("Custo total de R$ 171.000.", facts).ok).toBe(true);
    expect(reconcileText("Lucro de R$ 153.500,00.", facts).ok).toBe(true);
  });

  it("texto sem números passa", () => {
    expect(reconcileText("Revisar contratos de insumos.", facts)).toEqual({
      text: "Revisar contratos de insumos.",
      ok: true,
    });
  });
});

describe("sanitizeItems", () => {
  it("troca a frase com número inventado por uma frase calculada", () => {
    const reserve = factualItems(facts).risks;
    const out = sanitizeItems(["Queda de 42% no preço do milho.", "Custos merecem revisão."], facts, reserve);
    expect(out).toHaveLength(2);
    expect(out[0].includes("42%")).toBe(false);
    expect(out[1]).toBe("Custos merecem revisão.");
  });
});

describe("factualItems", () => {
  it("usa os números reais da fazenda", () => {
    const { risks, opportunities } = factualItems(facts);
    expect(risks.some((r) => r.includes("milho concentra 70,4% do lucro"))).toBe(true);
    expect(risks.some((r) => r.includes("R$ 5.850,00/ha") && r.includes("19,7%"))).toBe(true);
    expect(opportunities.some((o) => o.includes("216"))).toBe(true);
  });
});
