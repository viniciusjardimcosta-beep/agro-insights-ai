// Client-safe deterministic financial score used by both the automatic
// diagnostic (persisted) and the scenario simulator (in-memory only).
// IMPORTANT: keep this file free of server-only imports.
import { aggregateFarm } from "@/lib/calc";

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

export function computeScoreBreakdown(
  farm: ReturnType<typeof aggregateFarm>,
): {
  score: number;
  breakdown: ScoreBreakdownEntry[];
  reason: string;
} {
  const breakdown: ScoreBreakdownEntry[] = [];
  breakdown.push({ label: "Base inicial", points: 100 });

  const add = (label: string, points: number) => {
    if (points === 0) return;
    breakdown.push({ label, points });
  };

  const margin =
    farm.totalRevenue > 0 ? (farm.totalProfit / farm.totalRevenue) * 100 : -100;

  if (margin >= 50) add(`Margem líquida ${margin.toFixed(1)}% (acima de 50%)`, 5);
  else if (margin >= 35) add(`Margem líquida ${margin.toFixed(1)}% (35% a 50%)`, 3);
  else if (margin >= 20) add(`Margem líquida ${margin.toFixed(1)}% (20% a 35%)`, 0);
  else if (margin >= 10) add(`Margem líquida ${margin.toFixed(1)}% (10% a 20%)`, -10);
  else add(`Margem líquida ${margin.toFixed(1)}% (abaixo de 10%)`, -20);

  const profitByCrop: Record<string, number> = {};
  let totalPositiveProfit = 0;
  for (const f of farm.perField) {
    profitByCrop[f.field.crop] = (profitByCrop[f.field.crop] ?? 0) + f.profit;
  }
  for (const v of Object.values(profitByCrop)) if (v > 0) totalPositiveProfit += v;
  const topCropEntry = Object.entries(profitByCrop).sort((a, b) => b[1] - a[1])[0];
  const depPct =
    totalPositiveProfit > 0 && topCropEntry && topCropEntry[1] > 0
      ? (topCropEntry[1] / totalPositiveProfit) * 100
      : 0;
  const depLabel = (pts: number, faixa: string) =>
    add(
      `Dependência da cultura ${topCropEntry?.[0]} ${depPct.toFixed(1)}% do lucro (${faixa})`,
      pts,
    );
  if (depPct > 80) depLabel(-20, "acima de 80%");
  else if (depPct > 70) depLabel(-15, "70% a 80%");
  else if (depPct > 60) depLabel(-10, "60% a 70%");
  else if (depPct >= 50) depLabel(-5, "50% a 60%");

  const profitPerHaByCrop: Record<string, { profit: number; area: number }> = {};
  for (const f of farm.perField) {
    const c = (profitPerHaByCrop[f.field.crop] ??= { profit: 0, area: 0 });
    c.profit += f.profit;
    c.area += f.area;
  }
  const pphList = Object.entries(profitPerHaByCrop)
    .filter(([, v]) => v.area > 0)
    .map(([crop, v]) => ({ crop, pph: v.profit / v.area }));
  if (pphList.length >= 2) {
    const best = pphList.reduce((a, b) => (b.pph > a.pph ? b : a));
    const worst = pphList.reduce((a, b) => (b.pph < a.pph ? b : a));
    const ref = Math.max(Math.abs(best.pph), Math.abs(worst.pph));
    if (ref > 0) {
      const spreadPct = ((best.pph - worst.pph) / ref) * 100;
      const lbl = (pts: number, faixa: string) =>
        add(
          `Diferença de rentabilidade ${best.crop} vs ${worst.crop} ${spreadPct.toFixed(1)}% (${faixa})`,
          pts,
        );
      if (spreadPct > 70) lbl(-25, "acima de 70%");
      else if (spreadPct > 50) lbl(-15, "50% a 70%");
      else if (spreadPct >= 30) lbl(-5, "30% a 50%");
    }
  }

  const cropTotals: Record<string, { cost: number; revenue: number }> = {};
  for (const f of farm.perField) {
    const c = (cropTotals[f.field.crop] ??= { cost: 0, revenue: 0 });
    c.cost += f.totalCost;
    c.revenue += f.revenue;
  }
  const highCostCrops = Object.entries(cropTotals).filter(
    ([, v]) => v.revenue > 0 && v.cost / v.revenue > 0.7,
  );
  if (highCostCrops.length > 0) {
    const points = Math.max(-15, -5 * highCostCrops.length);
    add(
      `Custo elevado (>70% da receita) em ${highCostCrops.map(([c, v]) => `${c} ${Math.round((v.cost / v.revenue) * 100)}%`).join(", ")}`,
      points,
    );
  }

  const negativeFields = farm.perField.filter((f) => f.profit < 0);
  if (negativeFields.length > 0)
    add(
      `Talhões com lucro negativo: ${negativeFields.map((f) => f.field.name).join(", ")} (${negativeFields.length}× -25)`,
      -25 * negativeFields.length,
    );

  const costPerHaList = farm.perField
    .filter((f) => f.area > 0)
    .map((f) => f.costPerHa);
  const meanCostHa =
    costPerHaList.length > 0
      ? costPerHaList.reduce((s, v) => s + v, 0) / costPerHaList.length
      : 0;
  if (meanCostHa > 0) {
    const buckets = { b1: [] as string[], b2: [] as string[], b3: [] as string[] };
    for (const f of farm.perField) {
      if (f.area <= 0) continue;
      const overPct = ((f.costPerHa - meanCostHa) / meanCostHa) * 100;
      if (overPct > 35) buckets.b3.push(`${f.field.name} +${overPct.toFixed(1)}%`);
      else if (overPct >= 20) buckets.b2.push(`${f.field.name} +${overPct.toFixed(1)}%`);
      else if (overPct >= 10) buckets.b1.push(`${f.field.name} +${overPct.toFixed(1)}%`);
    }
    if (buckets.b3.length)
      add(`Custo/ha acima de 35% da média: ${buckets.b3.join(", ")}`, -20 * buckets.b3.length);
    if (buckets.b2.length)
      add(`Custo/ha 20% a 35% acima da média: ${buckets.b2.join(", ")}`, -10 * buckets.b2.length);
    if (buckets.b1.length)
      add(`Custo/ha 10% a 20% acima da média: ${buckets.b1.join(", ")}`, -5 * buckets.b1.length);
  }

  const beBuckets = { b1: [] as string[], b2: [] as string[], b3: [] as string[] };
  for (const f of farm.perField) {
    const est = Number(f.field.estimated_yield ?? 0);
    if (est <= 0 || f.breakevenBagPerHa <= 0) continue;
    const ratio = (f.breakevenBagPerHa / est) * 100;
    if (ratio > 80) beBuckets.b3.push(`${f.field.name} ${ratio.toFixed(1)}%`);
    else if (ratio > 65) beBuckets.b2.push(`${f.field.name} ${ratio.toFixed(1)}%`);
    else if (ratio > 50) beBuckets.b1.push(`${f.field.name} ${ratio.toFixed(1)}%`);
  }
  if (beBuckets.b3.length)
    add(`Ponto de equilíbrio acima de 80% da produtividade: ${beBuckets.b3.join(", ")}`, -20 * beBuckets.b3.length);
  if (beBuckets.b2.length)
    add(`Ponto de equilíbrio 65% a 80% da produtividade: ${beBuckets.b2.join(", ")}`, -10 * beBuckets.b2.length);
  if (beBuckets.b1.length)
    add(`Ponto de equilíbrio 50% a 65% da produtividade: ${beBuckets.b1.join(", ")}`, -5 * beBuckets.b1.length);

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

  if (farm.perField.length > 0 && farm.perField.every((f) => f.profit > 0))
    add("Todos os talhões lucrativos", 5);
  const allBEUnder60 =
    farm.perField.length > 0 &&
    farm.perField.every((f) => {
      const est = Number(f.field.estimated_yield ?? 0);
      if (est <= 0 || f.breakevenBagPerHa <= 0) return true;
      return f.breakevenBagPerHa / est <= 0.6;
    });
  if (allBEUnder60) add("Ponto de equilíbrio confortável em todos os talhões", 5);

  const rawSum = breakdown.reduce((s, b) => s + b.points, 0);
  let score = rawSum;
  if (score > 100) {
    const adj = 100 - score;
    breakdown.push({ label: "Ajuste para teto de 100", points: adj });
    score = 100;
  } else if (score < 0) {
    const adj = -score;
    breakdown.push({ label: "Ajuste para piso de 0", points: adj });
    score = 0;
  }

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
  const margin =
    farm.totalRevenue > 0 ? (farm.totalProfit / farm.totalRevenue) * 100 : 0;
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
  const totalRev = farm.totalRevenue;
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
    depPct: totalRev > 0 ? (topRev / totalRev) * 100 : 0,
    topCrop,
    costByCrop,
    priceByCrop,
    costPerHaByCrop,
    breakevenByCrop,
    profitPerHaByCrop,
    negativeFieldsCount: farm.perField.filter((f) => f.profit < 0).length,
  };
}