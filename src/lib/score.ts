// Client-safe deterministic financial score used by both the automatic
// diagnostic (persisted) and the scenario simulator (in-memory only).
// IMPORTANT: keep this file free of server-only imports.
import { aggregateFarm, weightedCostPerHa } from "@/lib/calc";

export type Metrics = {
  margin: number;
  revenue: number;
  costs: number;
  profit: number;
  profitPerHa: number;
  costPerHa: number;
  depPct: number;
  topCrop: string;
  costByCrop: Record<string, number>;
  priceByCrop: Record<string, number>;
  costPerHaByCrop: Record<string, number>;
  breakevenByCrop: Record<string, number>;
  profitPerHaByCrop: Record<string, number>;
  negativeFieldsCount: number;
};

export type ScoreBreakdownEntry = { label: string; points: number };

type PerField = ReturnType<typeof aggregateFarm>["perField"][number];

export type FieldRuleKind = "neg" | "be" | "custoha" | "custo_alto";

export type FieldAssessment = {
  f: PerField;
  /** A regra mais grave do talhão (a única que tira pontos). Null = nada a apontar. */
  rule: FieldRuleKind | null;
  points: number;
  /** Faixa/valor usado na descrição (ex.: 82.3 = % da produtividade). */
  value: number;
  /** Outros problemas do mesmo talhão: viram observação, sem pontos. */
  others: string[];
};

const RULE_ORDER: FieldRuleKind[] = ["neg", "be", "custoha", "custo_alto"];

/** Talhões com preço cadastrado: só eles têm receita de verdade e entram nas comparações. */
export function pricedFields(farm: ReturnType<typeof aggregateFarm>): PerField[] {
  return farm.perField.filter((f) => f.price > 0);
}

/**
 * Cada talhão perde pontos por UMA regra só: a mais grave entre lucro negativo, ponto de equilíbrio,
 * custo/ha acima da média e custo acima de 70% da receita. As outras viram observação, sem pontos.
 * Usado pela nota, pelo Diagnóstico e pelos Alertas — assim as três contas sempre batem.
 */
export function assessFields(farm: ReturnType<typeof aggregateFarm>): FieldAssessment[] {
  const pf = pricedFields(farm);
  // Média ponderada pela área (custo total ÷ área total), igual ao painel.
  const meanCostHa = weightedCostPerHa(pf);
  return pf.map((f) => {
    const cands: { rule: FieldRuleKind; points: number; value: number; text: string }[] = [];
    if (f.profit < 0) cands.push({ rule: "neg", points: -25, value: f.profit, text: "lucro negativo" });
    const est = Number(f.field.estimated_yield ?? 0);
    if (est > 0 && f.breakevenBagPerHa > 0) {
      const ratio = (f.breakevenBagPerHa / est) * 100;
      const pts = ratio > 80 ? -20 : ratio > 65 ? -10 : ratio > 50 ? -5 : 0;
      if (pts) cands.push({ rule: "be", points: pts, value: ratio, text: "ponto de equilíbrio alto" });
    }
    if (meanCostHa > 0 && f.area > 0) {
      const over = ((f.costPerHa - meanCostHa) / meanCostHa) * 100;
      const pts = over > 35 ? -20 : over >= 20 ? -10 : over >= 10 ? -5 : 0;
      if (pts) cands.push({ rule: "custoha", points: pts, value: over, text: "custo por hectare acima da média" });
    }
    if (f.revenue > 0 && f.totalCost / f.revenue > 0.7)
      cands.push({
        rule: "custo_alto",
        points: -5,
        value: (f.totalCost / f.revenue) * 100,
        text: "custo acima de 70% da receita",
      });
    cands.sort(
      (a, b) => a.points - b.points || RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule),
    );
    const top = cands[0];
    return {
      f,
      rule: top?.rule ?? null,
      points: top?.points ?? 0,
      value: top?.value ?? 0,
      others: cands.slice(1).map((c) => c.text),
    };
  });
}

/**
 * Dependência de cultura: participação da cultura mais lucrativa no lucro das culturas COM lucro
 * (talhões sem preço ficam de fora). Se a fazenda tem várias culturas mas só uma dá lucro, o problema
 * já foi contado no talhão em prejuízo, então a dependência não se aplica.
 */
export function cropDependency(farm: ReturnType<typeof aggregateFarm>): {
  crop: string;
  pct: number;
  applies: boolean;
} {
  const pf = pricedFields(farm);
  const profitByCrop: Record<string, number> = {};
  for (const f of pf) profitByCrop[f.field.crop] = (profitByCrop[f.field.crop] ?? 0) + f.profit;
  const positive = Object.entries(profitByCrop).filter(([, v]) => v > 0);
  const total = positive.reduce((a, [, v]) => a + v, 0);
  const top = positive.sort((a, b) => b[1] - a[1])[0];
  if (!top || total <= 0) return { crop: "", pct: 0, applies: false };
  const cropCount = Object.keys(profitByCrop).length;
  return {
    crop: top[0],
    pct: (top[1] / total) * 100,
    applies: cropCount === 1 || positive.length >= 2,
  };
}

/** Diferença de rentabilidade (lucro/ha) entre as culturas COM lucro. */
function profitSpread(farm: ReturnType<typeof aggregateFarm>) {
  const acc: Record<string, { profit: number; area: number }> = {};
  for (const f of pricedFields(farm)) {
    const c = (acc[f.field.crop] ??= { profit: 0, area: 0 });
    c.profit += f.profit;
    c.area += f.area;
  }
  const list = Object.entries(acc)
    .filter(([, v]) => v.area > 0 && v.profit > 0)
    .map(([crop, v]) => ({ crop, pph: v.profit / v.area }));
  if (list.length < 2) return null;
  const best = list.reduce((a, b) => (b.pph > a.pph ? b : a));
  const worst = list.reduce((a, b) => (b.pph < a.pph ? b : a));
  if (best.pph <= 0) return null;
  return { best: best.crop, worst: worst.crop, pct: ((best.pph - worst.pph) / best.pph) * 100 };
}

export function computeScoreBreakdown(
  farm: ReturnType<typeof aggregateFarm>,
): {
  score: number;
  breakdown: ScoreBreakdownEntry[];
  reason: string;
} {
  const breakdown: ScoreBreakdownEntry[] = [];
  breakdown.push({ label: "Base inicial", points: 100 });

  // Talhão sem preço cadastrado não tem receita de verdade: fica fora das comparações (margem, lucro negativo,
  // dependência de cultura...) para a mesma falta não ser punida várias vezes. A falta de preço é punida uma vez, mais abaixo.
  const pf = pricedFields(farm);
  const unpriced = farm.perField.filter((f) => !(f.price > 0));

  const add = (label: string, points: number) => {
    if (points === 0) return;
    breakdown.push({ label, points });
  };
  /** Observação: aparece na composição, mas não muda a nota. */
  const note = (label: string) => breakdown.push({ label, points: 0 });

  if (unpriced.length > 0)
    note(`Talhões sem preço não entraram no cálculo: ${unpriced.map((f) => f.field.name).join(", ")}`);

  const pricedRevenue = pf.reduce((a, f) => a + f.revenue, 0);
  const pricedProfit = pf.reduce((a, f) => a + f.profit, 0);
  const margin = pricedRevenue > 0 ? (pricedProfit / pricedRevenue) * 100 : -100;

  // Margem alta pesa de verdade: uma fazenda com 75% de margem nunca fica abaixo de uma no prejuízo.
  if (pf.length === 0) {
    // Nenhum talhão com preço: não dá para avaliar a margem.
  } else if (margin >= 50) add(`Margem líquida ${margin.toFixed(1)}% (acima de 50%)`, 15);
  else if (margin >= 35) add(`Margem líquida ${margin.toFixed(1)}% (35% a 50%)`, 8);
  else if (margin >= 20) add(`Margem líquida ${margin.toFixed(1)}% (20% a 35%)`, 0);
  else if (margin >= 10) add(`Margem líquida ${margin.toFixed(1)}% (10% a 20%)`, -10);
  else if (margin >= 0) add(`Margem líquida ${margin.toFixed(1)}% (abaixo de 10%)`, -20);
  else add(`Margem líquida ${margin.toFixed(1)}% (negativa)`, -35);

  // Concentração: só a regra mais grave entre "dependência" e "diferença entre culturas" tira pontos.
  const dep = cropDependency(farm);
  const depPts = !dep.applies ? 0 : dep.pct > 80 ? -20 : dep.pct > 70 ? -15 : dep.pct > 60 ? -10 : dep.pct >= 50 ? -5 : 0;
  const depFaixa = dep.pct > 80 ? "acima de 80%" : dep.pct > 70 ? "70% a 80%" : dep.pct > 60 ? "60% a 70%" : "50% a 60%";
  const depLabel = `Dependência da cultura ${dep.crop} ${dep.pct.toFixed(1)}% do lucro (${depFaixa})`;
  const spread = profitSpread(farm);
  const spreadPts = !spread ? 0 : spread.pct > 70 ? -25 : spread.pct > 50 ? -15 : spread.pct >= 30 ? -5 : 0;
  const spreadFaixa = spread && spread.pct > 70 ? "acima de 70%" : spread && spread.pct > 50 ? "50% a 70%" : "30% a 50%";
  const spreadLabel = spread
    ? `Diferença de rentabilidade ${spread.best} vs ${spread.worst} ${spread.pct.toFixed(1)}% (${spreadFaixa})`
    : "";
  if (depPts !== 0 || spreadPts !== 0) {
    if (spreadPts < depPts) {
      add(spreadLabel, spreadPts);
      if (depPts !== 0) note(`Observação (sem pontos, mesmo problema): ${depLabel}`);
    } else {
      add(depLabel, depPts);
      if (spreadPts !== 0) note(`Observação (sem pontos, mesmo problema): ${spreadLabel}`);
    }
  }

  // Talhões: cada um perde pontos por uma regra só.
  const assessed = assessFields(farm);
  const groups = new Map<string, { label: string; points: number; names: string[] }>();
  const groupOf = (a: FieldAssessment): { key: string; label: string } => {
    switch (a.rule) {
      case "neg":
        return { key: "neg", label: "Talhões com lucro negativo" };
      case "be":
        return {
          key: `be${a.points}`,
          label:
            a.points === -20
              ? "Ponto de equilíbrio acima de 80% da produtividade"
              : a.points === -10
                ? "Ponto de equilíbrio 65% a 80% da produtividade"
                : "Ponto de equilíbrio 50% a 65% da produtividade",
        };
      case "custoha":
        return {
          key: `cha${a.points}`,
          label:
            a.points === -20
              ? "Custo/ha acima de 35% da média"
              : a.points === -10
                ? "Custo/ha 20% a 35% acima da média"
                : "Custo/ha 10% a 20% acima da média",
        };
      default:
        return { key: "custo_alto", label: "Custo elevado (>70% da receita) em" };
    }
  };
  const order: string[] = [];
  for (const a of assessed) {
    if (!a.rule) continue;
    const { key, label } = groupOf(a);
    const g = groups.get(key) ?? { label, points: 0, names: [] };
    if (!groups.has(key)) order.push(key);
    const name =
      a.rule === "neg"
        ? a.f.field.name
        : a.rule === "custo_alto"
          ? `${a.f.field.name} ${Math.round(a.value)}%`
          : `${a.f.field.name} ${a.rule === "custoha" ? "+" : ""}${a.value.toFixed(1)}%`;
    g.names.push(name);
    g.points += a.points;
    groups.set(key, g);
  }
  const sortedKeys = ["neg", "be-20", "be-10", "be-5", "cha-20", "cha-10", "cha-5", "custo_alto"].filter((k) =>
    groups.has(k),
  );
  for (const k of sortedKeys) {
    const g = groups.get(k)!;
    if (k === "neg") add(`${g.label}: ${g.names.join(", ")} (${g.names.length}× -25)`, g.points);
    else if (k === "custo_alto") add(`${g.label} ${g.names.join(", ")}`, g.points);
    else add(`${g.label}: ${g.names.join(", ")}`, g.points);
  }
  for (const a of assessed) {
    if (a.others.length > 0)
      note(`Observação (sem pontos): ${a.f.field.name} também tem ${a.others.join(" e ")}`);
  }

  const cropsInFields = Array.from(new Set(farm.perField.map((f) => f.field.crop)));
  const missingPrice = cropsInFields.filter((c) => !(farm.priceByCrop[c] > 0));
  if (missingPrice.length > 0)
    add(`Falta de preço cadastrado (${missingPrice.join(", ")})`, -15);

  const missingCost = farm.perField.filter((f) => f.totalCost <= 0);
  if (missingCost.length > 0)
    add(
      `Falta de custo cadastrado (${missingCost.map((f) => f.field.name).join(", ")})`,
      -15,
    );

  if (pf.length > 0 && pf.length === farm.perField.length && pf.every((f) => f.profit > 0))
    add("Todos os talhões lucrativos", 5);
  const allBEUnder60 =
    pf.length > 0 &&
    pf.every((f) => {
      const est = Number(f.field.estimated_yield ?? 0);
      if (est <= 0 || f.breakevenBagPerHa <= 0) return true;
      return f.breakevenBagPerHa / est <= 0.6;
    });
  if (allBEUnder60) add("Ponto de equilíbrio confortável em todos os talhões", 5);

  // A nota fica sempre entre 0 e 100; quando a soma passa disso, só mostramos o limite (sem linha de "ajuste").
  const rawSum = breakdown.reduce((s, b) => s + b.points, 0);
  const score = Math.max(0, Math.min(100, rawSum));

  const reason =
    score >= 85
      ? "Excelente saúde financeira: margem sólida e poucos riscos identificados."
      : score >= 70
        ? "Saúde financeira saudável, com pontos de atenção localizados."
        : score >= 50
          ? "Saúde financeira em atenção: existem penalidades relevantes a corrigir."
          : score >= 30
            ? "Saúde financeira frágil: múltiplas penalidades reduzindo a nota."
            : "Saúde financeira crítica: prejuízos e/ou dados insuficientes dominam o resultado.";

  return { score, breakdown, reason };
}

export function computeMetrics(
  farm: ReturnType<typeof aggregateFarm>,
): Metrics {
  // Margem só dos talhões com preço (talhão sem preço não tem receita e distorceria a conta).
  const priced = pricedFields(farm);
  const pricedRev = priced.reduce((a, f) => a + f.revenue, 0);
  const margin = pricedRev > 0 ? (priced.reduce((a, f) => a + f.profit, 0) / pricedRev) * 100 : 0;
  const dep = cropDependency(farm);
  const byCrop: Record<
    string,
    { cost: number; revenue: number; profit: number; area: number; yieldSum: number; price: number }
  > = {};
  for (const f of farm.perField) {
    const c = (byCrop[f.field.crop] ??= {
      cost: 0,
      revenue: 0,
      profit: 0,
      area: 0,
      yieldSum: 0,
      price: f.price,
    });
    c.cost += f.totalCost;
    c.revenue += f.revenue;
    c.profit += f.profit;
    c.area += f.area;
    c.yieldSum += f.yieldBag * f.area;
    c.price = f.price || c.price;
  }
  let topCrop = "";
  let topRev = 0;
  const costByCrop: Record<string, number> = {};
  const priceByCrop: Record<string, number> = {};
  const costPerHaByCrop: Record<string, number> = {};
  const breakevenByCrop: Record<string, number> = {};
  const profitPerHaByCrop: Record<string, number> = {};
  for (const [crop, v] of Object.entries(byCrop)) {
    if (v.revenue > topRev) {
      topRev = v.revenue;
      topCrop = crop;
    }
    costByCrop[crop] = v.cost;
    priceByCrop[crop] = v.price;
    costPerHaByCrop[crop] = v.area > 0 ? v.cost / v.area : 0;
    profitPerHaByCrop[crop] = v.area > 0 ? v.profit / v.area : 0;
    breakevenByCrop[crop] = v.price > 0 && v.area > 0 ? v.cost / v.area / v.price : 0;
  }
  return {
    margin,
    revenue: farm.totalRevenue,
    costs: farm.totalCost,
    profit: farm.totalProfit,
    profitPerHa: farm.profitPerHa,
    costPerHa: farm.costPerHa,
    depPct: dep.applies ? dep.pct : 0,
    topCrop,
    costByCrop,
    priceByCrop,
    costPerHaByCrop,
    breakevenByCrop,
    profitPerHaByCrop,
    negativeFieldsCount: priced.filter((f) => f.profit < 0).length,
  };
}