import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createCorrelationId,
  recordAuditEvent,
  startTimer,
} from "@/lib/audit.server";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { createAiModel } from "@/lib/ai-model.server";
import { aggregateFarm, BRL, NUM, latestPriceByCrop } from "@/lib/calc";
import { buildFacts, factualItems, sanitizeItems } from "@/lib/report-facts";
import {
  computeScoreBreakdown as _computeScoreBreakdown,
  computeMetrics as _computeMetrics,
  cropDependency,
  pricedFields,
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

/** Indicadores-chave calculados pelo sistema (só talhões com preço), para não depender do que a IA escreve. */
function computeIndicators(farm: ReturnType<typeof aggregateFarm>): DiagnosticReport["indicators"] {
  const pf = pricedFields(farm);
  const byCrop: Record<string, { profit: number; area: number }> = {};
  for (const f of pf) {
    const c = (byCrop[f.field.crop] ??= { profit: 0, area: 0 });
    c.profit += f.profit;
    c.area += f.area;
  }
  const crops = Object.entries(byCrop)
    .filter(([, v]) => v.area > 0)
    .map(([crop, v]) => ({ crop, pph: v.profit / v.area }))
    .sort((a, b) => b.pph - a.pph);
  const fields = [...pf].filter((f) => f.area > 0).sort((a, b) => b.profitPerHa - a.profitPerHa);
  const fmt = (v: number) => `${v < 0 ? "-" : ""}${BRL.format(Math.abs(v))}/ha`;
  const dep = cropDependency(farm);
  return {
    mostProfitableCrop: crops[0] ? `${crops[0].crop} (${fmt(crops[0].pph)})` : "-",
    leastProfitableCrop: crops.length > 1 ? `${crops[crops.length - 1].crop} (${fmt(crops[crops.length - 1].pph)})` : "-",
    mostEfficientField: fields[0] ? `${fields[0].field.name} (${fmt(fields[0].profitPerHa)})` : "-",
    leastEfficientField:
      fields.length > 1 ? `${fields[fields.length - 1].field.name} (${fmt(fields[fields.length - 1].profitPerHa)})` : "-",
    singleCropDependencyPct: dep.applies ? dep.pct : 0,
  };
}

function fallbackReport(
  farm: ReturnType<typeof aggregateFarm>,
  textNote?: string,
): DiagnosticReport {
  // Mesma conta da nota e dos Alertas: participação no lucro das culturas lucrativas.
  const depInfo = cropDependency(farm);
  const dep = depInfo.applies ? depInfo.pct : 0;

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
      dep >= 70 ? `Alta dependência de uma única cultura (${Math.round(dep)}% do lucro).` : "Diversificação de culturas moderada.",
      "Custos por hectare merecem revisão detalhada por categoria.",
    ],
    opportunities: [
      "Renegociar insumos e revisar contratos de maior peso no custo.",
      "Melhorar comercialização travando preços em janelas favoráveis.",
      "Aprimorar gestão de fluxo de caixa e capital de giro.",
    ],
    indicators: {
      ...computeIndicators(farm),
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
    // Um único correlation_id liga started → (rate_limited|failed) → completed.
    const correlationId = createCorrelationId();
    const elapsed = startTimer();
    await recordAuditEvent(context.supabase, {
      eventType: "diagnostic_started",
      status: "started",
      entityType: "diagnostic",
      correlationId,
    });

    // Ordem obrigatória: autenticação -> entitlement -> validação -> rate limit -> IA.
    // Sem entitlement, NENHUMA quota de IA é consumida.
    const { requireEntitlement } = await import("@/lib/subscription.server");
    const { FEATURES } = await import("@/lib/entitlements");
    await requireEntitlement(context.supabase, FEATURES.DIAGNOSTIC, correlationId);

    const ai = createAiModel();
    if ("error" in ai) throw new Error(ai.error);

    const { checkRateLimit, DIAGNOSTIC_RATE_LIMIT_MESSAGE } = await import(
      "@/lib/rate-limit.server"
    );

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

    // Limite atômico apenas para a parte que gera custo (chamada externa de IA).
    const limit = await checkRateLimit(context.supabase, "diagnostic_ai_generation");
    if (!limit.allowed) {
      await recordAuditEvent(context.supabase, {
        eventType: "diagnostic_rate_limited",
        status: "blocked",
        entityType: "diagnostic",
        correlationId,
        metadata: { error_code: ERROR_CODES.DIAGNOSTIC_RATE_LIMITED, scope: limit.scope ?? "day" },
      });
      throw new AppError({
        code: ERROR_CODES.DIAGNOSTIC_RATE_LIMITED,
        status: 429,
        correlationId,
        userMessage: DIAGNOSTIC_RATE_LIMIT_MESSAGE,
      });
    }

    const summary = [
      `Propriedades: ${(props.data ?? []).map((p) => `${p.name} (${p.city ?? "-"}/${p.state ?? "-"}, ${p.total_area} ha)`).join("; ") || "nenhuma"}`,
      `Total: área ${NUM.format(farm.totalArea)} ha | custo ${BRL.format(farm.totalCost)} | receita ${BRL.format(farm.totalRevenue)} | lucro ${BRL.format(farm.totalProfit)} | lucro/ha ${BRL.format(farm.profitPerHa)}`,
      `Preços/saca: ${Object.entries(priceByCrop).map(([c, p]) => `${c} ${BRL.format(p)}`).join(", ") || "sem preços"}`,
      "Talhões:",
      ...farm.perField.map((f) =>
        !(f.price > 0)
          ? `- ${f.field.name} (${f.field.crop}, ${NUM.format(f.area)} ha): SEM PREÇO CADASTRADO — receita e lucro não calculados; custo ${BRL.format(f.totalCost)} (${BRL.format(f.costPerHa)}/ha)`
          : `- ${f.field.name} (${f.field.crop}, ${NUM.format(f.area)} ha): yield ${NUM.format(f.yieldBag)} sc/ha, custo ${BRL.format(f.totalCost)} (${BRL.format(f.costPerHa)}/ha), receita ${BRL.format(f.revenue)}, lucro ${BRL.format(f.profit)} (${BRL.format(f.profitPerHa)}/ha)`,
      ),
    ].join("\n");

    const system = `Você é um Analista Financeiro Rural. Gere um diagnóstico estruturado em JSON da fazenda do usuário. Regras:
- healthScore: 0-100 (0 = pré-falência; 100 = excelente). Considere lucro/ha, diversificação, custo/ha vs receita, talhões no prejuízo.
- finance: use EXATAMENTE os números do contexto (revenue, costs, profit, profitPerHa em reais).
- risks: até 3 riscos curtos, concretos, quantificados quando possível (PT-BR).
- opportunities: até 3 oportunidades curtas, concretas (PT-BR).
- indicators: cultura/talhão mais e menos lucrativo (por lucro por hectare, em R$/ha), e % de dependência da maior cultura sobre o LUCRO das culturas com lucro (o sistema recalcula os indicadores; não gaste texto neles).
- Talhões marcados SEM PREÇO CADASTRADO não têm receita nem lucro calculados: NUNCA diga que a receita é zero, que a produtividade é zero ou que há prejuízo por causa deles. Diga que falta cadastrar o preço e que, sem ele, não dá para avaliar a rentabilidade. Se NENHUM talhão tem preço, o diagnóstico é de dados insuficientes: o plano de ação deve começar por cadastrar os preços.
- actionPlan: EXATAMENTE 3 ações práticas priorizadas por impacto financeiro. NUNCA recomende aumentar área, trocar cultura ou alterar estratégia produtiva sem deixar claro que faltam dados agronômicos/climáticos. Priorize: custos, margem, comercialização, gestão financeira, eficiência operacional.
- Clareza: ao citar dependência de cultura, diga se é sobre receita, lucro ou área (ex.: "milho concentra 70% do lucro"; o sistema mede dependência pelo lucro). Não misture culturas na mesma frase sem dizer qual é qual. Ao citar valores por hectare, diga a que talhão ou cultura se referem e use R$/ha.
- Vocabulário: "lucro por hectare" é um valor em R$/ha (lucro ÷ área). "Margem" (ou "margem líquida") é um PERCENTUAL (lucro ÷ receita). Nunca chame um valor em R$ de "margem" nem um percentual de "lucro por hectare". Use "margem" só com %, e "lucro por hectare" ou "lucro/ha" só com R$/ha.
- Comparações de custo por hectare usam a MÉDIA DA FAZENDA (custo total ÷ área total). NUNCA cite média regional, de mercado, do setor ou de outras fazendas: o sistema não tem esses dados.
- Tudo em português do Brasil, frases curtas. Não invente dados além do contexto.`;

    const schemaHint = JSON.stringify(schemaShape, null, 2);
    const userPrompt = `Dados da fazenda:\n${summary}\n\nResponda APENAS com um JSON válido (sem markdown, sem comentários) seguindo EXATAMENTE este formato:\n${schemaHint}\n\nRegras:\n- Nos CAMPOS NUMÉRICOS do JSON use números crus (sem R$, sem pontos de milhar, ponto como decimal).\n- Nos TEXTOS (risks, opportunities, actionPlan) escreva valores como pessoas leem: R$ 5.850,00 e 19,7% (com R$, ponto de milhar e vírgula decimal).\n- risks e opportunities: no máximo 3 itens cada.\n- actionPlan: exatamente 3 strings.\n- Todos os campos são obrigatórios.`;

    let report: DiagnosticReport | null = null;
    let rawResponse = "";
    let aiFallbackUsed = false;
    try {
      const { text } = await generateText({
        model: ai.model,
        system,
        prompt: userPrompt,
      });
      rawResponse = text;
      const parsed = extractJson(text);
      const result = ReportSchema.safeParse(parsed);
      if (!result.success) {
        // Nunca logar `parsed` / texto do modelo: é conteúdo gerado sobre a
        // fazenda do usuário. Apenas os caminhos e códigos de validação.
        console.error("[diagnostico] schema mismatch", {
          issues: result.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
        });
        throw new Error("schema_mismatch");
      }
      report = normalize(result.data);
      // Números do texto da IA são conferidos contra os calculados pelo sistema:
      // arredondamentos errados são corrigidos; números sem correspondência real
      // fazem a frase ser trocada por uma frase calculada.
      const facts = buildFacts(farm as never, (costs.data ?? []) as never);
      const reserve = factualItems(facts);
      report = {
        ...report,
        risks: sanitizeItems(report.risks, facts, reserve.risks),
        opportunities: sanitizeItems(report.opportunities, facts, reserve.opportunities),
        actionPlan: sanitizeItems(report.actionPlan, facts, fallbackReport(farm).actionPlan),
      };
    } catch (err) {
      // `rawResponse` (resposta da IA) NÃO é logado — conteúdo sensível.
      console.error("[diagnostico] geração estruturada falhou — usando fallback", {
        error_code: (err as Error).message === "schema_mismatch" ? "SCHEMA_MISMATCH" : "AI_FAILED",
        correlation_id: correlationId,
      });
      aiFallbackUsed = true;
      await recordAuditEvent(context.supabase, {
        eventType: "diagnostic_failed",
        status: "failure",
        entityType: "diagnostic",
        correlationId,
        metadata: {
          error_code:
            (err as Error).message === "schema_mismatch" ? "SCHEMA_MISMATCH" : ERROR_CODES.AI_FAILED,
          fallback_used: true,
          duration_ms: elapsed(),
        },
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
      indicators: computeIndicators(farm),
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
    if (insertError) {
      await recordAuditEvent(context.supabase, {
        eventType: "diagnostic_failed",
        status: "failure",
        entityType: "diagnostic",
        correlationId,
        metadata: { error_code: "PERSIST_FAILED", duration_ms: elapsed() },
      });
      throw new AppError({
        code: ERROR_CODES.DIAGNOSTIC_FAILED,
        correlationId,
        userMessage: "Não foi possível salvar o diagnóstico. Tente novamente.",
        cause: insertError,
      });
    }
    await recordAuditEvent(context.supabase, {
      eventType: "diagnostic_completed",
      entityType: "diagnostic",
      entityId: (inserted as { id?: string })?.id ?? null,
      correlationId,
      metadata: { duration_ms: elapsed(), fallback_used: aiFallbackUsed },
    });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return inserted;
  });
/** Exclui um diagnóstico do histórico (a política de segurança do banco só deixa apagar os da própria conta). */
export const deleteDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("diagnostics").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
