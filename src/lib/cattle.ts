// Pecuária (recria e engorda): regras de cálculo puras (sem rede nem banco).
// A conta é por lote: investido = compra + custos do lote; resultado = venda - parte do investido que corresponde às cabeças vendidas.

export const ARROBA_KG = 15;
// cria = matrizes (vacas de cria); reprodutor = touros. Recria e engorda são os lotes de venda.
export const CATTLE_PHASES = ["cria", "recria", "engorda", "reprodutor"] as const;
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
  /** Detalhes opcionais do rebanho: sem eles o lote só não entra no quadro de estoque por idade e sexo. */
  sex?: CattleSex | null; entry_age_months?: number | null;
  /** Nascimento na fazenda: touro pai (texto livre) e lote de matrizes da mãe. */
  born_here?: boolean; sire_name?: string | null; dam_lot_id?: string | null;
};
export type CattleSex = "macho" | "femea";
export type CattleCost = { id: string; lot_id: string | null; category: string; description: string | null; amount: number; date: string };
export type CattleSale = { id: string; lot_id: string; date: string; head_count: number; arrobas: number | null; amount: number };

/** Baixa = animal que morreu ou se perdeu. O dinheiro já gasto fica no lote: quem sobra "carrega" o custo. */
export const LOSS_CAUSES = ["morte", "roubo", "sumico", "outro"] as const;
export type LossCause = (typeof LOSS_CAUSES)[number];
export type CattleLoss = { id: string; lot_id: string; date: string; head_count: number; notes?: string | null; cause?: LossCause | null };

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

// ---------------------------------------------------------------- estoque por faixa de idade e sexo
export const AGE_BRACKETS = [
  { key: "0-12", label: "0 a 12 meses", max: 12 },
  { key: "13-24", label: "13 a 24 meses", max: 24 },
  { key: "25-36", label: "25 a 36 meses", max: 36 },
  { key: "36+", label: "Mais de 36 meses", max: Infinity },
] as const;
export type AgeBracketKey = (typeof AGE_BRACKETS)[number]["key"];

const MONTH_DAYS = 30.4375;

/** Idade de hoje, em meses inteiros: idade informada na entrada + meses desde a entrada. null se a idade não foi informada. */
export function ageMonthsNow(lot: Pick<Lot, "entry_date" | "entry_age_months">, todayIso: string): number | null {
  if (lot.entry_age_months === null || lot.entry_age_months === undefined) return null;
  return lot.entry_age_months + Math.floor(daysBetween(lot.entry_date, todayIso) / MONTH_DAYS);
}

export function ageBracket(months: number): AgeBracketKey {
  return (AGE_BRACKETS.find((b) => months <= b.max) ?? AGE_BRACKETS[3]).key;
}

export type StockRow = { key: AgeBracketKey | "sem-idade"; label: string; macho: number; femea: number; semSexo: number; total: number };
export type StockSummary = {
  rows: StockRow[]; // 4 faixas + "idade não informada"
  total: number;
  matrizes: number;
  reprodutores: number;
  /** true quando pelo menos um lote com animais tem sexo ou idade: é o que liga o quadro na tela (modo detalhado). */
  detailed: boolean;
};

/** Quadro de estoque: cabeças que ainda estão na fazenda (descontadas vendas e baixas), por faixa de idade e sexo. */
export function summarizeStock(lots: Lot[], costs: CattleCost[], sales: CattleSale[], todayIso: string, losses: CattleLoss[] = []): StockSummary {
  const rows: StockRow[] = [
    ...AGE_BRACKETS.map((b) => ({ key: b.key as StockRow["key"], label: b.label, macho: 0, femea: 0, semSexo: 0, total: 0 })),
    { key: "sem-idade", label: "Idade não informada", macho: 0, femea: 0, semSexo: 0, total: 0 },
  ];
  let total = 0, matrizes = 0, reprodutores = 0, detailed = false;
  for (const lot of lots) {
    const left = summarizeLot(lot, costs, sales, todayIso, losses).headsLeft;
    if (left <= 0) continue;
    const months = ageMonthsNow(lot, todayIso);
    if (months !== null || lot.sex) detailed = true;
    const row = rows.find((r) => r.key === (months === null ? "sem-idade" : ageBracket(months)))!;
    if (lot.sex === "macho") row.macho += left; else if (lot.sex === "femea") row.femea += left; else row.semSexo += left;
    row.total += left;
    total += left;
    if (lot.phase === "cria") matrizes += left;
    if (lot.phase === "reprodutor") reprodutores += left;
  }
  return { rows, total, matrizes, reprodutores, detailed };
}

/** Divide um valor em centavos proporcional às cabeças de cada grupo; a sobra de arredondamento vai para o último. */
export function splitByHeads(total: number, heads: number[]): number[] {
  const sum = heads.reduce((a, b) => a + b, 0);
  if (sum <= 0) return heads.map(() => 0);
  const cents = Math.round(total * 100);
  const parts = heads.map((h) => Math.floor((cents * h) / sum));
  parts[parts.length - 1] += cents - parts.reduce((a, b) => a + b, 0);
  return parts.map((c) => c / 100);
}

export type SireGroup = { sire: string; femeas: number; machos: number };

/** Filhas (e filhos) de cada touro que ainda estão na fazenda. Serve para não cobrir filha com o pai. */
export function offspringBySire(lots: Lot[], costs: CattleCost[], sales: CattleSale[], todayIso: string, losses: CattleLoss[] = []): SireGroup[] {
  const map = new Map<string, SireGroup>();
  for (const lot of lots) {
    const sire = lot.sire_name?.trim();
    if (!sire) continue;
    const left = summarizeLot(lot, costs, sales, todayIso, losses).headsLeft;
    if (left <= 0) continue;
    const key = sire.toLowerCase();
    const g = map.get(key) ?? { sire, femeas: 0, machos: 0 };
    if (lot.sex === "femea") g.femeas += left; else g.machos += left;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.femeas - a.femeas || a.sire.localeCompare(b.sire));
}
