// Pecuária (recria e engorda): regras de cálculo puras (sem rede nem banco).
// A conta é por lote: investido = compra + custos do lote; resultado = venda - parte do investido que corresponde às cabeças vendidas.

export const ARROBA_KG = 15;
export const CATTLE_PHASES = ["recria", "engorda"] as const;
export type CattlePhase = (typeof CATTLE_PHASES)[number];

/** Categorias de custo mais usadas na pecuária (a lista geral de custos continua valendo). */
export const CATTLE_COST_CATEGORIES = [
  "Alimentação",
  "Sanidade",
  "Cercas e infraestrutura",
  "Serviços contratados",
  "Mão de obra",
  "Diesel",
  "Máquinas",
  "Arrendamento",
  "Impostos e taxas",
  "Outros",
] as const;

export type Lot = {
  id: string; name: string; phase: string; head_count: number; entry_date: string;
  entry_avg_weight_kg: number | null; purchase_amount: number; status: string; notes: string | null;
};
export type CattleCost = { id: string; lot_id: string | null; category: string; description: string | null; amount: number; date: string };
export type CattleSale = { id: string; lot_id: string; date: string; head_count: number; arrobas: number | null; amount: number };

/** Baixa = animal que morreu ou se perdeu. O dinheiro já gasto fica no lote: quem sobra "carrega" o custo. */
export type CattleLoss = { id: string; lot_id: string; date: string; head_count: number; notes?: string | null };

const cents = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => cents(xs.reduce((a, b) => a + b, 0));

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

export type LotSummary = {
  invested: number; // compra + custos do lote
  lotCosts: number;
  costPerHead: number;
  headsSold: number;
  headsLost: number;
  headsLeft: number;
  fullySold: boolean;
  soldAmount: number;
  arrobasSold: number | null; // só quando todas as vendas informaram arrobas
  pricePerArroba: number | null;
  costPerArroba: number | null; // investido nas cabeças vendidas / arrobas vendidas
  /** venda - parte do investido que corresponde às cabeças vendidas; null se nada foi vendido */
  result: number | null;
  marginPct: number | null;
  days: number;
};

export function summarizeLot(lot: Lot, costs: CattleCost[], sales: CattleSale[], todayIso: string, losses: CattleLoss[] = []): LotSummary {
  const lotCosts = sum(costs.filter((c) => c.lot_id === lot.id).map((c) => Number(c.amount)));
  const invested = cents(Number(lot.purchase_amount) + lotCosts);
  const mine = sales.filter((s) => s.lot_id === lot.id);
  const lostRows = losses.filter((l) => l.lot_id === lot.id);
  const headsLost = Math.min(lot.head_count, lostRows.reduce((a, l) => a + l.head_count, 0));
  const alive = lot.head_count - headsLost; // cabeças que não morreram: dividem o custo do lote
  const headsSold = mine.reduce((a, s) => a + s.head_count, 0);
  const headsLeft = Math.max(0, alive - headsSold);
  const fullySold = headsLeft === 0;
  const soldAmount = sum(mine.map((s) => Number(s.amount)));
  const allHaveArrobas = mine.length > 0 && mine.every((s) => s.arrobas !== null && Number(s.arrobas) > 0);
  const arrobasSold = allHaveArrobas ? cents(mine.reduce((a, s) => a + Number(s.arrobas), 0)) : null;
  const share = alive > 0 ? Math.min(1, headsSold / alive) : 1;
  const investedSold = cents(invested * share);
  // Sem venda nenhuma o resultado fica em aberto; se todas morreram, o prejuízo é o investido inteiro.
  const result = mine.length > 0 || alive <= 0 ? cents(soldAmount - investedSold) : null;
  const lastEvent = fullySold ? [...mine.map((s) => s.date), ...lostRows.map((l) => l.date)].sort().at(-1) ?? null : null;
  return {
    invested,
    lotCosts,
    costPerHead: alive > 0 ? cents(invested / alive) : 0,
    headsSold,
    headsLost,
    headsLeft,
    fullySold,
    soldAmount,
    arrobasSold,
    pricePerArroba: arrobasSold ? cents(soldAmount / arrobasSold) : null,
    costPerArroba: arrobasSold ? cents(investedSold / arrobasSold) : null,
    result,
    marginPct: result !== null && soldAmount > 0 ? Math.round((result / soldAmount) * 1000) / 10 : null,
    days: daysBetween(lot.entry_date, lastEvent ?? todayIso),
  };
}

/** Média de arrobas por cabeça das vendas já feitas (só se todas informaram arrobas); serve de ponto de partida. */
export function avgArrobasPerHead(lotId: string, sales: CattleSale[]): number | null {
  const mine = sales.filter((s) => s.lot_id === lotId);
  if (mine.length === 0 || !mine.every((s) => s.arrobas !== null && Number(s.arrobas) > 0)) return null;
  const heads = mine.reduce((a, s) => a + s.head_count, 0);
  const arr = mine.reduce((a, s) => a + Number(s.arrobas), 0);
  return heads > 0 ? cents(arr / heads) : null;
}

/**
 * Preço da arroba que fecha o lote sem prejuízo, vendendo o que sobrou com `arrobasPerHead` por cabeça.
 * 0 = o que já foi vendido cobriu todo o custo; null = não há o que calcular.
 */
export function breakEvenPerArroba(s: Pick<LotSummary, "invested" | "soldAmount" | "headsLeft">, arrobasPerHead: number): number | null {
  if (s.headsLeft <= 0 || !(arrobasPerHead > 0)) return null;
  const need = s.invested - s.soldAmount;
  if (need <= 0) return 0;
  return cents(need / (s.headsLeft * arrobasPerHead));
}

export type FarmSummary = {
  activeHeads: number;
  investedInActive: number; // parte do investido nas cabeças que ainda estão na fazenda
  soldAmount: number;
  lotsResult: number; // soma dos resultados dos lotes com venda
  generalCosts: number; // custos sem lote
  resultAfterGeneral: number;
};

export function summarizeFarm(lots: Lot[], costs: CattleCost[], sales: CattleSale[], todayIso: string, losses: CattleLoss[] = []): FarmSummary {
  let activeHeads = 0, investedInActive = 0, soldAmount = 0, lotsResult = 0;
  for (const lot of lots) {
    const s = summarizeLot(lot, costs, sales, todayIso, losses);
    const alive = lot.head_count - s.headsLost;
    activeHeads += s.headsLeft;
    investedInActive += alive > 0 ? s.invested * (s.headsLeft / alive) : 0;
    soldAmount += s.soldAmount;
    lotsResult += s.result ?? 0;
  }
  const generalCosts = sum(costs.filter((c) => c.lot_id === null).map((c) => Number(c.amount)));
  return {
    activeHeads,
    investedInActive: cents(investedInActive),
    soldAmount: cents(soldAmount),
    lotsResult: cents(lotsResult),
    generalCosts,
    resultAfterGeneral: cents(lotsResult - generalCosts),
  };
}

/** Preço por arroba a partir do valor e das arrobas; null se faltar dado. */
export function pricePerArroba(amount: number, arrobas: number | null): number | null {
  return arrobas && arrobas > 0 && amount > 0 ? cents(amount / arrobas) : null;
}
