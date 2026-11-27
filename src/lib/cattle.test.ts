import { describe, expect, it } from "vitest";
import { ageBracket, cattleSummaryText, ageMonthsNow, avgArrobasPerHead, breakEvenPerArroba, daysBetween, pricePerArroba, summarizeFarm, summarizeLot, summarizeStock, offspringBySire, splitByHeads, type CattleCost, type CattleLoss, type CattleSale, type Lot } from "./cattle";

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

describe("estoque por faixa de idade e sexo", () => {
  const base = { entry_avg_weight_kg: null, purchase_amount: 0, status: "ativo", notes: null, phase: "recria" } as const;
  const L = (o: Partial<Lot> & { id: string }): Lot => ({ name: o.id, head_count: 10, entry_date: "2026-01-01", ...base, ...o }) as Lot;
  it("limites das faixas", () => {
    expect(ageBracket(0)).toBe("0-12");
    expect(ageBracket(12)).toBe("0-12");
    expect(ageBracket(13)).toBe("13-24");
    expect(ageBracket(24)).toBe("13-24");
    expect(ageBracket(25)).toBe("25-36");
    expect(ageBracket(36)).toBe("25-36");
    expect(ageBracket(37)).toBe("36+");
  });
  it("a idade avança sozinha com o tempo", () => {
    const lot = L({ id: "a", entry_date: "2026-01-01", entry_age_months: 11 });
    expect(ageMonthsNow(lot, "2026-01-01")).toBe(11);
    expect(ageMonthsNow(lot, "2026-03-05")).toBe(13); // +2 meses
    expect(ageBracket(ageMonthsNow(lot, "2026-03-05")!)).toBe("13-24");
    expect(ageMonthsNow(L({ id: "b" }), "2026-03-05")).toBeNull();
  });
  it("quadro soma só o que ainda está na fazenda", () => {
    const lots = [
      L({ id: "m", sex: "macho", entry_age_months: 6, head_count: 10 }),
      L({ id: "f", sex: "femea", entry_age_months: 30, head_count: 20, phase: "cria" }),
      L({ id: "t", sex: "macho", entry_age_months: 48, head_count: 2, phase: "reprodutor" }),
      L({ id: "x", head_count: 5 }),
    ];
    const sales: CattleSale[] = [{ id: "s", lot_id: "m", date: "2026-02-01", head_count: 4, arrobas: null, amount: 1 }];
    const losses: CattleLoss[] = [{ id: "l", lot_id: "f", date: "2026-02-01", head_count: 1 }];
    const q = summarizeStock(lots, [], sales, "2026-01-02", losses);
    expect(q.detailed).toBe(true);
    expect(q.total).toBe(6 + 19 + 2 + 5);
    expect(q.rows[0].macho).toBe(6);
    expect(q.rows[2].femea).toBe(19);
    expect(q.rows[3].macho).toBe(2);
    expect(q.rows[4].semSexo).toBe(5);
    expect(q.matrizes).toBe(19);
    expect(q.reprodutores).toBe(2);
  });
  it("sem sexo nem idade em nenhum lote, o modo detalhado fica desligado", () => {
    const q = summarizeStock([L({ id: "a" }), L({ id: "b" })], [], [], "2026-01-02");
    expect(q.detailed).toBe(false);
    expect(q.total).toBe(20);
  });
  it("lote já vendido não conta", () => {
    const sales: CattleSale[] = [{ id: "s", lot_id: "a", date: "2026-02-01", head_count: 10, arrobas: null, amount: 1 }];
    const q = summarizeStock([L({ id: "a", sex: "macho", entry_age_months: 5 })], [], sales, "2026-03-01");
    expect(q.total).toBe(0);
    expect(q.detailed).toBe(false);
  });
});

describe("dividir o valor pago entre grupos", () => {
  it("proporcional às cabeças e soma exata", () => {
    const r = splitByHeads(100000, [10, 30]);
    expect(r[0]).toBe(25000);
    expect(r[1]).toBe(75000);
    const q = splitByHeads(100, [1, 1, 1]);
    expect(Math.round((q[0] + q[1] + q[2]) * 100)).toBe(10000);
  });
});

describe("filhos por touro", () => {
  const mk = (o: Partial<Lot> & { id: string }): Lot => ({ name: o.id, phase: "recria", head_count: 5, entry_date: "2026-01-01", entry_avg_weight_kg: null, purchase_amount: 0, status: "ativo", notes: null, ...o }) as Lot;
  it("agrupa por pai, ignora maiúsculas e o que já saiu", () => {
    const lots = [
      mk({ id: "a", sex: "femea", sire_name: "Tufão", head_count: 4 }),
      mk({ id: "b", sex: "femea", sire_name: "tufão", head_count: 3 }),
      mk({ id: "c", sex: "macho", sire_name: "Tufão", head_count: 2 }),
      mk({ id: "d", sex: "femea", sire_name: "Rei", head_count: 5 }),
      mk({ id: "e", sex: "femea", head_count: 9 }),
    ];
    const sales: CattleSale[] = [{ id: "s", lot_id: "d", date: "2026-02-01", head_count: 5, arrobas: null, amount: 1 }];
    const r = offspringBySire(lots, [], sales, "2026-03-01");
    expect(r).toHaveLength(1);
    expect(r[0].sire).toBe("Tufão");
    expect(r[0].femeas).toBe(7);
    expect(r[0].machos).toBe(2);
  });
});

describe("baixa depois da venda", () => {
  const lot20: Lot = { id: "L9", name: "Lote 9", phase: "engorda", head_count: 20, entry_date: "2026-01-01", entry_avg_weight_kg: null, purchase_amount: 60000, status: "ativo", notes: null };
  const c: CattleCost[] = [{ id: "c", lot_id: "L9", category: "Sanidade", description: null, amount: 2000, date: "2026-02-01" }];
  const sale: CattleSale[] = [{ id: "s", lot_id: "L9", date: "2026-06-01", head_count: 10, arrobas: 180, amount: 40000 }];
  it("não muda o resultado da venda já feita", () => {
    const antes = summarizeLot(lot20, c, sale, "2026-07-01", []);
    const depois = summarizeLot(lot20, c, sale, "2026-07-01", [{ id: "b", lot_id: "L9", date: "2026-06-20", head_count: 1 }]);
    expect(antes.result).toBe(9000);
    expect(depois.result).toBe(9000);
  });
  it("a baixa antes da venda continua dividida entre as que sobraram", () => {
    const r = summarizeLot(lot20, c, sale, "2026-07-01", [{ id: "b", lot_id: "L9", date: "2026-05-01", head_count: 1 }]);
    expect(r.result).toBeCloseTo(40000 - (62000 * 10) / 19, 1);
  });
});
describe("resumo para o Consultor", () => {
  it("lista os lotes com os números", () => {
    const lot20: Lot = { id: "L9", name: "Lote 9", phase: "engorda", head_count: 20, entry_date: "2026-01-01", entry_avg_weight_kg: null, purchase_amount: 60000, status: "ativo", notes: null };
    const t = cattleSummaryText([lot20], [], [], [], "2026-07-01");
    expect(t).toContain("Lote 9");
    expect(t).toContain("20 na fazenda");
    expect(cattleSummaryText([], [], [], [], "2026-07-01")).toContain("nenhum lote");
  });
});
