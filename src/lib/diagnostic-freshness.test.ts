import { describe, expect, it } from "vitest";
import { diagnosticFreshness } from "@/lib/diagnostic-freshness";
import { ptPercentDecimals } from "@/lib/format-pt";

describe("diagnosticFreshness", () => {
  const live = { totalRevenue: 370000, totalCost: 161000 };

  it("não alerta quando os valores batem", () => {
    expect(diagnosticFreshness({ revenue: 370000, costs: 161000 }, live)).toEqual({ stale: false, changes: [] });
  });

  it("tolera diferença de centavos", () => {
    expect(diagnosticFreshness({ revenue: 370000.4, costs: 160999.6 }, live).stale).toBe(false);
  });

  it("alerta quando a receita mudou (caso real: preço da soja alterado)", () => {
    const r = diagnosticFreshness({ revenue: 344000, costs: 161000 }, live);
    expect(r.stale).toBe(true);
    expect(r.changes).toEqual([{ label: "Receita", saved: 344000, live: 370000 }]);
  });

  it("lista receita e custos quando ambos mudaram", () => {
    const r = diagnosticFreshness({ revenue: 100, costs: 50 }, live);
    expect(r.changes.map((c) => c.label)).toEqual(["Receita", "Custos"]);
  });

  it("não alarma sem valores guardados", () => {
    expect(diagnosticFreshness(null, live).stale).toBe(false);
    expect(diagnosticFreshness({}, live).stale).toBe(false);
    expect(diagnosticFreshness({ revenue: "x", costs: NaN }, live).stale).toBe(false);
  });
});

describe("ptPercentDecimals", () => {
  it("troca ponto por vírgula só em percentuais", () => {
    expect(ptPercentDecimals("Margem líquida 53.2% (acima de 50%)")).toBe("Margem líquida 53,2% (acima de 50%)");
    expect(ptPercentDecimals("Custo/ha 10% a 20% acima da média: Talhão 1 +12.0%")).toBe(
      "Custo/ha 10% a 20% acima da média: Talhão 1 +12,0%",
    );
    expect(ptPercentDecimals("Ponto de equilíbrio 50% a 65%: Talhão 1 56.6%")).toBe(
      "Ponto de equilíbrio 50% a 65%: Talhão 1 56,6%",
    );
  });
  it("não altera valores sem percentual nem textos já em vírgula", () => {
    expect(ptPercentDecimals("R$ 5.971,43 por ha")).toBe("R$ 5.971,43 por ha");
    expect(ptPercentDecimals("Todos os talhões lucrativos")).toBe("Todos os talhões lucrativos");
    expect(ptPercentDecimals("Margem 53,2%")).toBe("Margem 53,2%");
  });
});
