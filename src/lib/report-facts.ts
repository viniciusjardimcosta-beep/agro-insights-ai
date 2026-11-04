// Verificação dos NÚMEROS que a IA escreve nos textos do diagnóstico.
// A IA redige riscos, oportunidades e plano de ação, mas errava arredondamentos
// (ex.: "19,8%" quando o cálculo é 19,7%). Aqui o sistema:
//  1. calcula todos os números "permitidos" a partir dos dados reais;
//  2. corrige números ligeiramente errados para o valor calculado;
//  3. troca a frase inteira por uma frase determinística quando o número
//     não corresponde a nenhum valor real (possível invenção).
// Módulo puro: sem rede, sem banco.

import { weightedCostPerHa } from "@/lib/calc";

type FieldLite = {
  field: { name: string; crop: string };
  area: number;
  yieldBag: number;
  price: number;
  totalCost: number;
  revenue: number;
  profit: number;
  costPerHa: number;
  profitPerHa: number;
  breakevenBagPerHa: number;
};
type FarmLite = {
  totalArea: number;
  totalCost: number;
  totalRevenue: number;
  totalProfit: number;
  costPerHa: number;
  profitPerHa: number;
  perField: FieldLite[];
};

export type Facts = {
  money: number[]; // valores absolutos em R$
  pct: number[]; // valores absolutos em %
  meanCostHa: number;
  totalProfit: number;
  fields: {
    name: string;
    crop: string;
    profit: number;
    costPerHa: number;
    margin: number | null;
    overMeanPct: number;
  }[];
  crops: {
    crop: string;
    profit: number;
    profitPerHa: number;
    profitSharePct: number | null;
  }[];
  cropPairDiffs: { best: string; worst: string; pct: number }[];
};

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : null);

export function buildFacts(
  farm: FarmLite,
  costs: { category: string; amount: number }[] = [],
): Facts {
  const money = new Set<number>();
  const pct = new Set<number>();
  const addM = (v: number | null | undefined) => {
    if (v != null && Number.isFinite(v)) money.add(Math.abs(v));
  };
  const addP = (v: number | null | undefined) => {
    if (v != null && Number.isFinite(v)) pct.add(Math.abs(v));
  };

  const meanCostHa = weightedCostPerHa(farm.perField);
  [farm.totalCost, farm.totalRevenue, farm.totalProfit, farm.costPerHa, farm.profitPerHa, meanCostHa].forEach(addM);
  addP(farm.totalRevenue > 0 ? (farm.totalProfit / farm.totalRevenue) * 100 : null);

  type Ent = { key: string; area: number; cost: number; revenue: number; profit: number };
  const crops = new Map<string, Ent>();
  const ents: Ent[] = [];
  const fieldsOut: Facts["fields"] = [];

  for (const f of farm.perField.slice(0, 40)) {
    [f.totalCost, f.revenue, f.profit, f.costPerHa, f.profitPerHa, f.price].forEach(addM);
    const margin = safeDiv(f.profit, f.revenue);
    addP(margin == null ? null : margin * 100);
    addP(safeDiv(f.area, farm.totalArea) == null ? null : (f.area / farm.totalArea) * 100);
    addP(safeDiv(f.totalCost, farm.totalCost) == null ? null : (f.totalCost / farm.totalCost) * 100);
    addP(safeDiv(f.totalCost, f.revenue) == null ? null : (f.totalCost / f.revenue) * 100);
    addP(safeDiv(f.breakevenBagPerHa, f.yieldBag) == null ? null : (f.breakevenBagPerHa / f.yieldBag) * 100);
    const over = meanCostHa > 0 && f.area > 0 ? ((f.costPerHa - meanCostHa) / meanCostHa) * 100 : 0;
    addP(over);
    fieldsOut.push({
      name: f.field.name,
      crop: f.field.crop,
      profit: f.profit,
      costPerHa: f.costPerHa,
      margin: margin == null ? null : margin * 100,
      overMeanPct: over,
    });
    const e = { key: f.field.name, area: f.area, cost: f.totalCost, revenue: f.revenue, profit: f.profit };
    ents.push(e);
    const c = crops.get(f.field.crop) ?? { key: f.field.crop, area: 0, cost: 0, revenue: 0, profit: 0 };
    c.area += f.area;
    c.cost += f.totalCost;
    c.revenue += f.revenue;
    c.profit += f.profit;
    crops.set(f.field.crop, c);
  }

  const cropList = [...crops.values()];
  const cropsOut: Facts["crops"] = [];
  for (const c of cropList) {
    addM(c.cost);
    addM(c.revenue);
    addM(c.profit);
    addM(safeDiv(c.cost, c.area));
    addM(safeDiv(c.profit, c.area));
    addP(safeDiv(c.profit, c.revenue) == null ? null : (c.profit / c.revenue) * 100);
    addP(safeDiv(c.area, farm.totalArea) == null ? null : (c.area / farm.totalArea) * 100);
    addP(safeDiv(c.revenue, farm.totalRevenue) == null ? null : (c.revenue / farm.totalRevenue) * 100);
    const share = farm.totalProfit > 0 ? (c.profit / farm.totalProfit) * 100 : null;
    addP(share);
    addP(safeDiv(c.cost, c.revenue) == null ? null : (c.cost / c.revenue) * 100);
    cropsOut.push({
      crop: c.key,
      profit: c.profit,
      profitPerHa: c.area > 0 ? c.profit / c.area : 0,
      profitSharePct: share,
    });
  }

  // Diferenças percentuais entre pares (lucro/ha e custo/ha) de culturas e de talhões.
  const pairs = (list: Ent[]) => {
    const l = list.filter((e) => e.area > 0).slice(0, 12);
    for (const a of l)
      for (const b of l) {
        if (a === b) continue;
        for (const sel of [(e: Ent) => e.profit / e.area, (e: Ent) => e.cost / e.area]) {
          const vb = sel(b);
          if (Math.abs(vb) > 0) addP(((sel(a) - vb) / Math.abs(vb)) * 100);
        }
      }
  };
  pairs(ents);
  pairs(cropList);

  const cropPairDiffs: Facts["cropPairDiffs"] = [];
  const ranked = cropsOut.filter((c) => c.profitPerHa !== 0 || c.profit !== 0).sort((a, b) => b.profitPerHa - a.profitPerHa);
  if (ranked.length > 1) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (worst.profitPerHa > 0)
      cropPairDiffs.push({ best: best.crop, worst: worst.crop, pct: ((best.profitPerHa - worst.profitPerHa) / worst.profitPerHa) * 100 });
  }

  // Categorias de custo.
  const byCat = new Map<string, number>();
  for (const c of costs) byCat.set(c.category, (byCat.get(c.category) ?? 0) + Number(c.amount || 0));
  for (const v of byCat.values()) {
    addM(v);
    addP(safeDiv(v, farm.totalCost) == null ? null : (v / farm.totalCost) * 100);
  }

  return {
    money: [...money],
    pct: [...pct],
    meanCostHa,
    totalProfit: farm.totalProfit,
    fields: fieldsOut,
    crops: cropsOut,
    cropPairDiffs,
  };
}

// ---------------------------------------------------------------- parsing

export function parseNumber(raw: string): number {
  const s = raw.trim();
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) return Number(s.replace(/\./g, "").replace(",", "."));
  if (hasComma) return Number(s.replace(",", "."));
  if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  return Number(s);
}

const decimalsOf = (raw: string) => {
  const m = raw.match(/[.,](\d+)$/);
  if (!m) return 0;
  // "5.850" (milhar) não é decimal.
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return 0;
  return m[1].length;
};

const fmt = (v: number, decimals: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const roundTo = (v: number, d: number) => {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
};

function nearest(list: number[], target: number): number | null {
  let best: number | null = null;
  for (const v of list) if (best === null || Math.abs(v - target) < Math.abs(best - target)) best = v;
  return best;
}

export function reconcileText(text: string, facts: Facts): { text: string; ok: boolean } {
  let ok = true;

  // Percentuais: 19,8% | 70.3 % | 57%
  let out = text.replace(/(\d+(?:[.,]\d+)?)(\s*)%/g, (full, raw: string, sp: string) => {
    const value = Math.abs(parseNumber(raw));
    const d = decimalsOf(raw);
    if (facts.pct.some((f) => roundTo(f, d) === value)) return full; // confere
    const near = nearest(facts.pct, value);
    const tol = d === 0 ? 0.6 : 0.3;
    if (near !== null && Math.abs(near - value) <= tol) return `${fmt(near, d)}${sp}%`;
    ok = false;
    return full;
  });

  // Valores em R$ (com multiplicador "mil/milhão" só validado, nunca reescrito).
  out = out.replace(/R\$\s*(\d[\d.,]*)(\s*(?:mil|milh[ãa]o|milh[õo]es|k)\b)?/gi, (full, raw: string, mult?: string) => {
    const base = parseNumber(raw.replace(/[.,]+$/, ""));
    if (!Number.isFinite(base)) {
      ok = false;
      return full;
    }
    if (mult) {
      const m = /mil\b|k/i.test(mult.trim()) && !/milh/i.test(mult) ? 1e3 : 1e6;
      const value = base * m;
      const near = nearest(facts.money, value);
      if (near === null || Math.abs(near - value) / Math.max(near, 1) > 0.05) ok = false;
      return full;
    }
    const d = decimalsOf(raw.replace(/[.,]+$/, ""));
    const value = Math.abs(base);
    if (facts.money.some((f) => (d === 0 ? Math.round(f) === Math.round(value) : Math.abs(f - value) < 0.005))) return full;
    const near = nearest(facts.money, value);
    if (near !== null && Math.abs(near - value) / Math.max(near, 1) <= 0.005) {
      return `R$ ${fmt(near, d === 0 ? 0 : 2)}`;
    }
    ok = false;
    return full;
  });

  // Números "crus" com 2 casas decimais e ponto (ex.: 5850.00, 108000.00), que a IA às vezes
  // escreve sem "R$". Se correspondem a um valor real, viram "R$ 5.850,00"; senão, a frase é
  // marcada como não verificável. (Percentuais e valores já com "R$" já foram tratados acima.)
  out = out.replace(/(?<![\d.,$])(?<!R\$\s)(\d{1,9}\.\d{2})(?![\d%]|\s*%)/g, (full, raw: string) => {
    const value = Number(raw);
    const near = nearest(facts.money, value);
    if (near !== null && Math.abs(near - value) < 0.005) return `R$ ${fmt(near, 2)}`;
    ok = false;
    return full;
  });

  return { text: out, ok };
}

// ---------------------------------------------------------------- frases de reserva

const brl = (v: number) => `R$ ${fmt(v, 2)}`;
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

export function factualItems(facts: Facts): { risks: string[]; opportunities: string[] } {
  const risks: string[] = [];
  const opps: string[] = [];

  const negative = facts.fields.filter((f) => f.profit < 0).map((f) => f.name);
  if (negative.length) risks.push(`Resultado negativo em: ${negative.join(", ")}.`);

  const top = [...facts.crops]
    .filter((c) => c.profitSharePct != null)
    .sort((a, b) => (b.profitSharePct ?? 0) - (a.profitSharePct ?? 0))[0];
  if (facts.crops.length > 1 && top && (top.profitSharePct ?? 0) >= 50)
    risks.push(`${cap(top.crop)} concentra ${fmt(top.profitSharePct ?? 0, 1)}% do lucro da fazenda (dependência de uma cultura).`);

  const over = [...facts.fields].sort((a, b) => b.overMeanPct - a.overMeanPct)[0];
  if (facts.fields.length > 1 && over && over.overMeanPct >= 10 && facts.meanCostHa > 0) {
    risks.push(
      `${over.name} gasta ${brl(over.costPerHa)}/ha, ${fmt(over.overMeanPct, 1)}% acima da média da fazenda (${brl(facts.meanCostHa)}/ha).`,
    );
    opps.push(`Reduzir o custo por hectare de ${over.name} em direção à média da fazenda (${brl(facts.meanCostHa)}/ha).`);
  }

  const lowMargin = facts.fields.filter((f) => f.margin != null).sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0))[0];
  if (facts.fields.length > 1 && lowMargin && lowMargin.margin != null)
    risks.push(`${lowMargin.name} tem a menor margem líquida da fazenda: ${fmt(lowMargin.margin, 1)}%.`);

  const d = facts.cropPairDiffs[0];
  if (d && d.pct > 0)
    opps.push(`${cap(d.best)} entrega lucro por hectare ${fmt(d.pct, 1)}% superior ao de ${d.worst}.`);

  opps.push("Melhorar a comercialização, travando preços em janelas favoráveis.");
  opps.push("Revisar contratos e insumos de maior peso no custo.");
  risks.push("Custos por hectare merecem revisão por categoria.");

  return { risks, opportunities: opps };
}

const numbersIn = (t: string) => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => parseNumber(n));

/** True se todos os números da frase já aparecem (±0,05) em alguma frase aceita: mesma ideia repetida. */
function repeatsIdea(candidate: string, accepted: string[]): boolean {
  const nums = numbersIn(candidate);
  if (nums.length === 0) return accepted.includes(candidate);
  return accepted.some((a) => {
    const an = numbersIn(a);
    return nums.every((n) => an.some((x) => Math.abs(x - n) < 0.05));
  });
}

/** Corrige números divergentes e troca frases não verificáveis por frases calculadas. */
export function sanitizeItems(
  items: string[],
  facts: Facts,
  reserve: string[],
  max = 3,
): string[] {
  const out: string[] = [];
  const spare = [...reserve];
  for (const item of items.slice(0, max)) {
    const r = reconcileText(item, facts);
    if (r.ok) {
      out.push(r.text);
      continue;
    }
    // Troca por uma frase calculada que não repita ideia já presente na lista
    // (considera também as frases originais ainda por vir).
    const taken = [...out, ...items.filter((x) => x !== item)];
    let next = spare.shift();
    while (next !== undefined && repeatsIdea(next, taken)) next = spare.shift();
    if (next) out.push(next);
  }
  return out;
}
