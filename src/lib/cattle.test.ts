import { describe, expect, it } from "vitest";
import { avgArrobasPerHead, breakEvenPerArroba, daysBetween, pricePerArroba, summarizeFarm, summarizeLot, type CattleCost, type CattleLoss, type CattleSale, type Lot } from "./cattle";

const lot: Lot = { id: "L1", name: "Lote 1", phase: "engorda", head_count: 10, entry_date: "2026-06-01", entry_avg_weight_kg: 300, purchase_amount: 30000, status: "ativo", notes: null };
const costs: CattleCost[] = [
  { id: "c1", lot_id: "L1", category: "Alimentação", description: null, amount: 5000, date: "2026-07-01" },
  { id: "c2", lot_id: "L1", category: "Sanidade", description: null, amount: 1000, date: "2026-07-02" },
  { id: "c3", lot_id: null, category: "Cercas e infraestrutura", description: null, amount: 2000, date: "2026-07-03" },
];

describe("summarizeLot", () => {
  it("sem venda: só investido e custo por cabeça", () => {
    const s = summarizeLot(lot, costs, [], "2026-11-11");
    expect(s.invested).toBe(36000);
    expect(s.costPerHead).toBe(3600);
    expect(s.result).toBeNull();
    expect(s.headsLeft).toBe(10);
    expect(s.fullySold).toBe(false);
    expect(s.days).toBe(163);
  });
  it("venda do lote inteiro: resultado, preço e custo por arroba", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 10, arrobas: 150, amount: 45000 }];
    const s = summarizeLot(lot, costs, sales, "2026-11-11");
    expect(s.result).toBe(9000);
    expect(s.marginPct).toBe(20);
    expect(s.pricePerArroba).toBe(300);
    expect(s.costPerArroba).toBe(240);
    expect(s.fullySold).toBe(true);
    expect(s.days).toBe(122); // até a última venda, não até hoje
  });
  it("venda parcial usa só a parte proporcional do investido", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 4, arrobas: 60, amount: 18000 }];
    const s = summarizeLot(lot, costs, sales, "2026-11-11");
    expect(s.result).toBe(3600); // 18000 - 36000*0,4
    expect(s.headsLeft).toBe(6);
    expect(s.fullySold).toBe(false);
  });
  it("sem arrobas informadas não inventa preço por arroba", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 10, arrobas: null, amount: 45000 }];
    const s = summarizeLot(lot, costs, sales, "2026-11-11");
    expect(s.pricePerArroba).toBeNull();
    expect(s.costPerArroba).toBeNull();
    expect(s.result).toBe(9000);
  });
  it("ignora custos e vendas de outros lotes", () => {
    const other: CattleCost = { id: "x", lot_id: "L2", category: "Sanidade", description: null, amount: 999, date: "2026-07-01" };
    expect(summarizeLot(lot, [...costs, other], [], "2026-11-11").invested).toBe(36000);
  });
});

describe("summarizeFarm", () => {
  it("soma lotes e desconta custos gerais", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 10, arrobas: 150, amount: 45000 }];
    const f = summarizeFarm([lot], costs, sales, "2026-11-11");
    expect(f.lotsResult).toBe(9000);
    expect(f.generalCosts).toBe(2000);
    expect(f.resultAfterGeneral).toBe(7000);
    expect(f.activeHeads).toBe(0);
  });
  it("lote ativo conta o investido nas cabeças que ficaram", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 4, arrobas: 60, amount: 18000 }];
    const f = summarizeFarm([lot], costs, sales, "2026-11-11");
    expect(f.activeHeads).toBe(6);
    expect(f.investedInActive).toBe(21600);
  });
});

describe("utilidades", () => {
  it("dias entre datas", () => expect(daysBetween("2026-11-01", "2026-11-11")).toBe(10));
  it("preço por arroba", () => {
    expect(pricePerArroba(45000, 150)).toBe(300);
    expect(pricePerArroba(45000, null)).toBeNull();
  });
});

describe("baixas (animais que morreram)", () => {
  const loss: CattleLoss[] = [{ id: "b1", lot_id: "L1", date: "2026-08-01", head_count: 1 }];
  it("quem sobra carrega o custo: custo por cabeça sobe", () => {
    const s = summarizeLot(lot, costs, [], "2026-11-11", loss);
    expect(s.headsLost).toBe(1);
    expect(s.headsLeft).toBe(9);
    expect(s.costPerHead).toBe(4000);
    expect(s.result).toBeNull();
  });
  it("vender todas as que sobraram fecha o lote e absorve a perda", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 9, arrobas: 135, amount: 45000 }];
    const s = summarizeLot(lot, costs, sales, "2026-11-11", loss);
    expect(s.fullySold).toBe(true);
    expect(s.headsLeft).toBe(0);
    expect(s.result).toBe(9000);
  });
  it("venda parcial usa o investido pelas cabeças vivas", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 3, arrobas: 45, amount: 15000 }];
    const s = summarizeLot(lot, costs, sales, "2026-11-11", loss);
    expect(s.result).toBe(3000); // 15.000 - 36.000 * 3/9
    const f = summarizeFarm([lot], costs, sales, "2026-11-11", loss);
    expect(f.activeHeads).toBe(6);
    expect(f.investedInActive).toBe(24000);
  });
  it("se todas morreram, o prejuízo é o investido inteiro", () => {
    const all: CattleLoss[] = [{ id: "b1", lot_id: "L1", date: "2026-08-01", head_count: 10 }];
    const s = summarizeLot(lot, costs, [], "2026-11-11", all);
    expect(s.fullySold).toBe(true);
    expect(s.result).toBe(-36000);
    expect(s.costPerHead).toBe(0);
  });
  it("baixa de outro lote não interfere", () => {
    const other: CattleLoss[] = [{ id: "b9", lot_id: "L2", date: "2026-08-01", head_count: 5 }];
    expect(summarizeLot(lot, costs, [], "2026-11-11", other).headsLeft).toBe(10);
  });
});

describe("ponto de equilíbrio da arroba", () => {
  it("lote sem venda: investido dividido pelas arrobas que sobram", () => {
    const s = summarizeLot(lot, costs, [], "2026-11-11");
    expect(breakEvenPerArroba(s, 18)).toBe(200); // 36.000 / (10 x 18)
  });
  it("com venda parcial, desconta o que já entrou", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 4, arrobas: 72, amount: 18000 }];
    const s = summarizeLot(lot, costs, sales, "2026-11-11");
    expect(breakEvenPerArroba(s, 18)).toBeCloseTo(166.67, 2); // (36.000 - 18.000) / (6 x 18)
  });
  it("já cobriu o custo: zero; sem cabeças ou sem arrobas: null", () => {
    const sales: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 4, arrobas: 72, amount: 40000 }];
    expect(breakEvenPerArroba(summarizeLot(lot, costs, sales, "2026-11-11"), 18)).toBe(0);
    expect(breakEvenPerArroba(summarizeLot(lot, costs, [], "2026-11-11"), 0)).toBeNull();
    const done: CattleSale[] = [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 10, arrobas: 150, amount: 45000 }];
    expect(breakEvenPerArroba(summarizeLot(lot, costs, done, "2026-11-11"), 18)).toBeNull();
  });
  it("média de arrobas por cabeça só com todas as vendas informadas", () => {
    expect(avgArrobasPerHead("L1", [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 4, arrobas: 72, amount: 1 }])).toBe(18);
    expect(avgArrobasPerHead("L1", [{ id: "s1", lot_id: "L1", date: "2026-10-01", head_count: 4, arrobas: null, amount: 1 }])).toBeNull();
    expect(avgArrobasPerHead("L1", [])).toBeNull();
  });
});
