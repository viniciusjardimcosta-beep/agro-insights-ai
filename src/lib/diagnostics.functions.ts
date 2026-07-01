import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { aggregateFarm, BRL, NUM, latestPriceByCrop } from "@/lib/calc";
import {
  computeScoreBreakdown as _computeScoreBreakdown,
  computeMetrics as _computeMetrics,
} from "@/lib/score";

export const computeScoreBreakdown = _computeScoreBreakdown;
export const computeMetrics = _computeMetrics;

// Lenient schema: coerce numbers, allow extra fields, fill defaults so the AI
// rarely fails validation. We normalize/cap arrays after parsing.
const num = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}, z.number());

const ReportSchema = z.object({
  healthScore: num,
  finance: z.object({
    revenue: num,
    costs: num,
    profit: num,
    profitPerHa: num,
  }),
  risks: z.array(z.string()).default([]),
  opportunities: z.array(z.string()).default([]),
  indicators: z.object({
    mostProfitableCrop: z.string().default("-"),
    leastProfitableCrop: z.string().default("-"),
    mostEfficientField: z.string().default("-"),
    leastEfficientField: z.string().default("-"),
    singleCropDependencyPct: num.default(0),
  }),
  actionPlan: z.array(z.string()).default([]),
  scoreBreakdown: z
    .array(z.object({ label: z.string(), points: num }))
    .default([]),
  scoreReason: z.string().default(""),
  metrics: z
    .object({
      margin: num.default(0),
      revenue: num.default(0),
      costs: num.default(0),
      profit: num.default(0),
      profitPerHa: num.default(0),
      costPerHa: num.default(0),
      depPct: num.default(0),
      topCrop: z.string().default(""),
      costByCrop: z.record(z.string(), num).default({}),
      priceByCrop: z.record(z.string(), num).default({}),
      costPerHaByCrop: z.record(z.string(), num).default({}),
      breakevenByCrop: z.record(z.string(), num).default({}),
      profitPerHaByCrop: z.record(z.string(), num).default({}),
      negativeFieldsCount: num.default(0),
    })
    .default({
      margin: 0,
      revenue: 0,
      costs: 0,
      profit: 0,
      profitPerHa: 0,
      costPerHa: 0,
      depPct: 0,
      topCrop: "",
      costByCrop: {},
      priceByCrop: {},
      costPerHaByCrop: {},
      breakevenByCrop: {},
      profitPerHaByCrop: {},
      negativeFieldsCount: 0,
    }),
});

export type DiagnosticReport = z.infer<typeof ReportSchema>;

const schemaShape = {
  healthScore: "number 0-100",
  finance: { revenue: "number", costs: "number", profit: "number", profitPerHa: "number" },
  risks: ["string", "..."],
  opportunities: ["string", "..."],
  indicators: {
    mostProfitableCrop: "string",
    leastProfitableCrop: "string",
    mostEfficientField: "string",
    leastEfficientField: "string",
    singleCropDependencyPct: "number 0-100",
  },
  actionPlan: ["string", "string", "string"],
};

function extractJson(raw: string): unknown {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.search(/[\{\[]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start === -1 || end === -1 || end < start) throw new Error("Sem JSON na resposta");
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    const repaired = s
      .replace(/,\s*}/g, "}")
      .replace(/,\s*\]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, " ");
    return JSON.parse(repaired);
  }
}

function normalize(report: DiagnosticReport): DiagnosticReport {
  return {
    ...report,
    healthScore: Math.max(0, Math.min(100, Math.round(report.healthScore))),
    risks: report.risks.slice(0, 3),
    opportunities: report.opportunities.slice(0, 3),
    actionPlan: report.actionPlan.slice(0, 3),
    indicators: {
      ...report.indicators,
      singleCropDependencyPct: Math.max(0, Math.min(100, report.indicators.singleCropDependencyPct)),
    },
  };
}

function fallbackReport(
  farm: ReturnType<typeof aggregateFarm>,
  textNote?: string,
): DiagnosticReport {
  const byCrop: Record<string, { revenue: number; profit: number; area: number }> = {};
  for (const f of farm.perField) {
    const c = (byCrop[f.field.crop] ??= { revenue: 0, profit: 0, area: 0 });
    c.revenue += f.revenue;
    c.profit += f.profit;
    c.area += f.area;
  }
  const crops = Object.entries(byCrop);
  const sortedByProfit = [...crops].sort((a, b) =>
    (b[1].area > 0 ? b[1].profit / b[1].area : -Infinity) -
    (a[1].area > 0 ? a[1].profit / a[1].area : -Infinity),
  );
  const sortedFields = [...farm.perField].sort((a, b) => b.profitPerHa - a.profitPerHa);
  const topCropRev = crops.reduce((m, [, v]) => Math.max(m, v.revenue), 0);
  const dep = farm.totalRevenue > 0 ? (topCropRev / farm.totalRevenue) * 100 : 0;

  const margin = farm.totalRevenue > 0 ? (farm.totalProfit / farm.totalRevenue) * 100 : -100;
  const { score, breakdown } = computeScoreBreakdown(farm);

  return normalize({
    healthScore: score,
    scoreBreakdown: breakdown,
    scoreReason: "",
    metrics: computeMetrics(farm),
    finance: {
      revenue: farm.totalRevenue,
      costs: farm.totalCost,
      profit: farm.totalProfit,
      profitPerHa: farm.profitPerHa,
    },
    risks: [
      farm.totalProfit < 0 ? "Resultado negativo no consolidado da fazenda." : "Margem apertada em parte dos talhões.",
      dep >= 70 ? `Alta dependência de uma única cultura (${Math.round(dep)}% da receita).` : "Diversificação de culturas moderada.",
      "Custos por hectare merecem revisão detalhada por categoria.",
    ],
    opportunities: [
      "Renegociar insumos e revisar contratos de maior peso no custo.",
      "Melhorar comercialização travando preços em janelas favoráveis.",
      "Aprimorar gestão de fluxo de caixa e capital de giro.",
    ],
    indicators: {
      mostProfitableCrop: sortedByProfit[0]?.[0] ?? "-",
      leastProfitableCrop: sortedByProfit[sortedByProfit.length - 1]?.[0] ?? "-",
      mostEfficientField: sortedFields[0]?.field.name ?? "-",
      leastEfficientField: sortedFields[sortedFields.length - 1]?.field.name ?? "-",
      singleCropDependencyPct: dep,
    },
    actionPlan: [
      "Mapear os 5 maiores custos por talhão e renegociar fornecedores.",
      "Revisar política de comercialização e definir gatilhos de venda por cultura.",
      textNote
        ? "Reforçar controles financeiros (fluxo de caixa, conciliação e indicadores mensais)."
        : "Reforçar controles financeiros (fluxo de caixa, conciliação e indicadores mensais).",
    ],
  });
}

export function computeScoreBreakdown(
  farm: ReturnType<typeof aggregateFarm>,
): {
  score: number;
  breakdown: { label: string; points: number }[];
  reason: string;
} {
  const breakdown: { label: string; points: number }[] = [];
  breakdown.push({ label: "Base inicial", points: 100 });

  const add = (label: string, points: number) => {
    if (points === 0) return;
    breakdown.push({ label, points });
  };

  const margin =
    farm.totalRevenue > 0 ? (farm.totalProfit / farm.totalRevenue) * 100 : -100;

  // Margin bands (graduated)
  if (margin >= 50) add(`Margem líquida ${margin.toFixed(1)}% (acima de 50%)`, 5);
  else if (margin >= 35) add(`Margem líquida ${margin.toFixed(1)}% (35% a 50%)`, 3);
  else if (margin >= 20) add(`Margem líquida ${margin.toFixed(1)}% (20% a 35%)`, 0);
  else if (margin >= 10) add(`Margem líquida ${margin.toFixed(1)}% (10% a 20%)`, -10);
  else add(`Margem líquida ${margin.toFixed(1)}% (abaixo de 10%)`, -20);

  // Crop dependency by PROFIT
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

  // Rentability spread between best and worst crop (profit/ha)
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

  // High cost/revenue ratio per crop ("custo elevado da soja" etc.)
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

  // -25 per field with negative profit
  const negativeFields = farm.perField.filter((f) => f.profit < 0);
  if (negativeFields.length > 0)
    add(
      `Talhões com lucro negativo: ${negativeFields.map((f) => f.field.name).join(", ")} (${negativeFields.length}× -25)`,
      -25 * negativeFields.length,
    );

  // Cost/ha 25% above mean
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

  // Breakeven / estimated yield, graduated per field
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

  // Missing price for any crop
  const cropsInFields = Array.from(new Set(farm.perField.map((f) => f.field.crop)));
  const missingPrice = cropsInFields.filter((c) => !(farm.priceByCrop[c] > 0));
  if (missingPrice.length > 0)
    add(`Falta de preço cadastrado (${missingPrice.join(", ")})`, -15);

  // Missing cost for any field
  const missingCost = farm.perField.filter((f) => f.totalCost <= 0);
  if (missingCost.length > 0)
    add(
      `Falta de custo cadastrado (${missingCost.map((f) => f.field.name).join(", ")})`,
      -15,
    );

  // Bonuses (margin bonus is already part of the graduated band above)
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

  // Raw sum + cap adjustment as a visible breakdown entry so the math is honest.
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
): DiagnosticReport["metrics"] {
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

export const listDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("diagnostics")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const latestDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("diagnostics")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const generateDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");

    const [props, fields, costs, prices] = await Promise.all([
      context.supabase.from("properties").select("name, city, state, total_area"),
      context.supabase.from("fields").select("*"),
      context.supabase.from("costs").select("field_id, category, amount, date, description"),
      context.supabase.from("prices").select("crop, price_per_bag, date"),
    ]);

    const farm = aggregateFarm(
      (fields.data ?? []) as never,
      (costs.data ?? []) as never,
      (prices.data ?? []) as never,
    );
    const priceByCrop = latestPriceByCrop((prices.data ?? []) as never);

    if (farm.perField.length === 0) {
      throw new Error("Cadastre propriedades, talhões, custos e preços antes de gerar o diagnóstico.");
    }

    const summary = [
      `Propriedades: ${(props.data ?? []).map((p) => `${p.name} (${p.city ?? "-"}/${p.state ?? "-"}, ${p.total_area} ha)`).join("; ") || "nenhuma"}`,
      `Total: área ${NUM.format(farm.totalArea)} ha | custo ${BRL.format(farm.totalCost)} | receita ${BRL.format(farm.totalRevenue)} | lucro ${BRL.format(farm.totalProfit)} | lucro/ha ${BRL.format(farm.profitPerHa)}`,
      `Preços/saca: ${Object.entries(priceByCrop).map(([c, p]) => `${c} ${BRL.format(p)}`).join(", ") || "sem preços"}`,
      "Talhões:",
      ...farm.perField.map(
        (f) =>
          `- ${f.field.name} (${f.field.crop}, ${NUM.format(f.area)} ha): yield ${NUM.format(f.yieldBag)} sc/ha, custo ${BRL.format(f.totalCost)} (${BRL.format(f.costPerHa)}/ha), receita ${BRL.format(f.revenue)}, lucro ${BRL.format(f.profit)} (${BRL.format(f.profitPerHa)}/ha)`,
      ),
    ].join("\n");

    const system = `Você é um Analista Financeiro Rural. Gere um diagnóstico estruturado em JSON da fazenda do usuário. Regras:
- healthScore: 0-100 (0 = pré-falência; 100 = excelente). Considere lucro/ha, diversificação, custo/ha vs receita, talhões no prejuízo.
- finance: use EXATAMENTE os números do contexto (revenue, costs, profit, profitPerHa em reais).
- risks: até 3 riscos curtos, concretos, quantificados quando possível (PT-BR).
- opportunities: até 3 oportunidades curtas, concretas (PT-BR).
- indicators: cultura/talhão mais e menos lucrativo (por margem/ha), e % de dependência da maior cultura sobre a receita total.
- actionPlan: EXATAMENTE 3 ações práticas priorizadas por impacto financeiro. NUNCA recomende aumentar área, trocar cultura ou alterar estratégia produtiva sem deixar claro que faltam dados agronômicos/climáticos. Priorize: custos, margem, comercialização, gestão financeira, eficiência operacional.
- Tudo em português do Brasil, frases curtas. Não invente dados além do contexto.`;

    const gateway = createLovableAiGatewayProvider(LOVABLE_API_KEY);
    const schemaHint = JSON.stringify(schemaShape, null, 2);
    const userPrompt = `Dados da fazenda:\n${summary}\n\nResponda APENAS com um JSON válido (sem markdown, sem comentários) seguindo EXATAMENTE este formato:\n${schemaHint}\n\nRegras:\n- Use números crus (sem R$, sem pontos de milhar, ponto como decimal).\n- risks e opportunities: no máximo 3 itens cada.\n- actionPlan: exatamente 3 strings.\n- Todos os campos são obrigatórios.`;

    let report: DiagnosticReport | null = null;
    let rawResponse = "";
    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system,
        prompt: userPrompt,
      });
      rawResponse = text;
      const parsed = extractJson(text);
      const result = ReportSchema.safeParse(parsed);
      if (!result.success) {
        console.error("[diagnostico] schema mismatch", {
          expected: schemaShape,
          received: parsed,
          issues: result.error.issues.map((i) => ({
            path: i.path.join("."),
            code: i.code,
            message: i.message,
          })),
        });
        throw new Error("schema_mismatch");
      }
      report = normalize(result.data);
    } catch (err) {
      console.error("[diagnostico] geração estruturada falhou — usando fallback", {
        error: (err as Error).message,
        raw: rawResponse.slice(0, 2000),
      });
      report = fallbackReport(farm, rawResponse);
    }

    // Always compute deterministic score + breakdown from real data, overriding AI.
    const computed = computeScoreBreakdown(farm);
    const metrics = computeMetrics(farm);
    report = {
      ...report,
      healthScore: computed.score,
      scoreBreakdown: computed.breakdown,
      scoreReason: computed.reason,
      metrics,
    };

    const { data: inserted, error: insertError } = await context.supabase
      .from("diagnostics")
      .insert({
        user_id: context.userId,
        health_score: Math.round(report.healthScore),
        report: report as never,
      })
      .select()
      .single();
    if (insertError) throw new Error(insertError.message);
    return inserted;
  });