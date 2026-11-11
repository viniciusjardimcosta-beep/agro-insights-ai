import { describe, expect, it } from "vitest";
import { daysBetween, pricePerArroba, summarizeFarm, summarizeLot, type CattleCost, type CattleSale, type Lot } from "./cattle";

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
