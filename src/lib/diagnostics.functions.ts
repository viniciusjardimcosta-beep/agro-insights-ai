import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { aggregateFarm, BRL, NUM, latestPriceByCrop } from "@/lib/calc";

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

  // Margin penalties (mutually exclusive bands)
  if (margin < 10) add(`Margem líquida abaixo de 10% (${margin.toFixed(1)}%)`, -25);
  else if (margin < 20)
    add(`Margem líquida entre 10% e 20% (${margin.toFixed(1)}%)`, -15);

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
  if (depPct > 75)
    add(
      `Dependência da cultura ${topCropEntry?.[0]} acima de 75% do lucro (${Math.round(depPct)}%)`,
      -20,
    );
  else if (depPct > 60)
    add(
      `Dependência da cultura ${topCropEntry?.[0]} acima de 60% do lucro (${Math.round(depPct)}%)`,
      -10,
    );

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
      if (spreadPct > 50)
        add(
          `Diferença de rentabilidade entre ${best.crop} e ${worst.crop} acima de 50% (${Math.round(spreadPct)}%)`,
          -15,
        );
      else if (spreadPct > 30)
        add(
          `Diferença de rentabilidade entre ${best.crop} e ${worst.crop} acima de 30% (${Math.round(spreadPct)}%)`,
          -10,
        );
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

  // Any field with negative profit
  const negativeFields = farm.perField.filter((f) => f.profit < 0);
  if (negativeFields.length > 0)
    add(
      `Talhão com lucro negativo (${negativeFields.map((f) => f.field.name).join(", ")})`,
      -25,
    );

  // Cost/ha 25% above mean
  const costPerHaList = farm.perField
    .filter((f) => f.area > 0)
    .map((f) => f.costPerHa);
  const meanCostHa =
    costPerHaList.length > 0
      ? costPerHaList.reduce((s, v) => s + v, 0) / costPerHaList.length
      : 0;
  const highCostFields = farm.perField.filter(
    (f) => meanCostHa > 0 && f.costPerHa > meanCostHa * 1.25,
  );
  if (highCostFields.length > 0)
    add(
      `Custo por hectare 25% acima da média (${highCostFields.map((f) => f.field.name).join(", ")})`,
      -10,
    );

  // Breakeven > 70% of estimated yield
  const beHigh = farm.perField.filter((f) => {
    const est = Number(f.field.estimated_yield ?? 0);
    return est > 0 && f.breakevenBagPerHa > 0 && f.breakevenBagPerHa / est > 0.7;
  });
  if (beHigh.length > 0)
    add(
      `Ponto de equilíbrio acima de 70% da produtividade estimada (${beHigh.map((f) => f.field.name).join(", ")})`,
      -10,
    );

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

  // Bonuses
  if (farm.perField.length > 0 && farm.perField.every((f) => f.profit > 0))
    add("Todos os talhões lucrativos", 5);
  if (margin > 30) add(`Margem líquida acima de 30% (${margin.toFixed(1)}%)`, 5);
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
    report = {
      ...report,
      healthScore: computed.score,
      scoreBreakdown: computed.breakdown,
      scoreReason: computed.reason,
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