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

    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");

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
    let aiFallbackUsed = false;
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
        // Nunca logar `parsed` / texto do modelo: é conteúdo gerado sobre a
        // fazenda do usuário. Apenas os caminhos e códigos de validação.
        console.error("[diagnostico] schema mismatch", {
          issues: result.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
        });
        throw new Error("schema_mismatch");
      }
      report = normalize(result.data);
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