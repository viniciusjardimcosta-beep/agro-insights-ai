// Central de Inteligência — pure, deterministic prioritization layer.
// It NEVER computes new financial formulas or scores: it only reads the
// existing farm aggregation (calc.ts), the existing score engine (score.ts),
// saved diagnostics and saved simulated scenarios, and ranks what matters.
import { aggregateFarm, BRL, NUM, type CostRow, type FieldRow, type PriceRow } from "@/lib/calc";
import { computeMetrics, computeScoreBreakdown, type ScoreBreakdownEntry } from "@/lib/score";

export type DiagnosticLite = {
  id: string;
  created_at: string;
  health_score: number;
  report: {
    risks?: string[];
    opportunities?: string[];
    actionPlan?: string[];
    scoreBreakdown?: ScoreBreakdownEntry[];
    scoreReason?: string;
  } | null;
};

export type ScenarioLite = {
  id: string;
  name: string;
  created_at: string;
  simulated_score: number;
  score_breakdown: ScoreBreakdownEntry[] | null;
  metrics_snapshot: Record<string, unknown> | null;
};

export type IntelligenceInput = {
  properties: { id?: string; name: string }[];
  fields: FieldRow[];
  costs: CostRow[];
  prices: PriceRow[];
  diagnostics: DiagnosticLite[]; // newest first
  scenarios: ScenarioLite[];
};

export type Severity = "critical" | "high" | "medium" | "positive";

export type ActionLink = { label: string; to: string };

export type Alert = {
  key: string;
  severity: Exclude<Severity, "positive">;
  title: string;
  reason: string;
  metric: string;
  impact: string;
  action: string;
  link?: ActionLink;
};

export type PrimaryProblem = {
  key: string;
  title: string;
  detail: string;
  points: number;
  action: string;
  link?: ActionLink;
} | null;

export type PrimaryOpportunity =
  | {
      source: "scenario" | "penalty" | "diagnostic";
      title: string;
      detail: string;
      currentScore: number;
      simulatedScore?: number;
      scorePotential?: number;
      profitDelta?: number;
      scenarioId?: string;
      link?: ActionLink;
    }
  | null;

export type NextAction = {
  available: boolean;
  action: string;
  reason: string;
  link?: ActionLink;
};

export type Evolution = {
  available: boolean;
  message?: string;
  current?: number;
  previous?: number;
  delta?: number;
  causes: { display: string; impact: number }[];
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/* ---------------------------- rule identity ---------------------------- */

export function ruleKeyOf(label: string): { key: string; display: string } | null {
  if (!label) return null;
  if (label === "Base inicial") return null;
  if (label.startsWith("Ajuste para")) return null;
  if (label.startsWith("Margem líquida")) return { key: "margem", display: "Margem líquida baixa" };
  if (label.startsWith("Dependência da cultura")) {
    const m = label.match(/Dependência da cultura (\S+)/);
    return { key: `dep:${m?.[1] ?? ""}`, display: `Dependência excessiva de ${m?.[1] ?? "uma cultura"}` };
  }
  if (label.startsWith("Diferença de rentabilidade"))
    return { key: "spread", display: "Diferença de rentabilidade entre culturas" };
  if (label.startsWith("Custo elevado"))
    return { key: "custo_alto", display: "Custo elevado em relação à receita" };
  if (label.startsWith("Talhões com lucro negativo"))
    return { key: "neg_fields", display: "Talhões com lucro negativo" };
  if (label.startsWith("Custo/ha")) return { key: "custo_ha", display: "Custo por hectare acima da média" };
  if (label.startsWith("Ponto de equilíbrio confortável"))
    return { key: "be_confort", display: "Ponto de equilíbrio confortável" };
  if (label.startsWith("Ponto de equilíbrio"))
    return { key: "breakeven", display: "Ponto de equilíbrio elevado" };
  if (label.startsWith("Falta de preço")) return { key: "missing_price", display: "Falta de preço cadastrado" };
  if (label.startsWith("Falta de custo")) return { key: "missing_cost", display: "Falta de custo cadastrado" };
  if (label.startsWith("Todos os talhões lucrativos"))
    return { key: "all_profit", display: "Todos os talhões lucrativos" };
  return { key: `outro:${label}`, display: label };
}

const ACTION_BY_KEY: Record<string, { action: string; link?: ActionLink }> = {
  margem: {
    action: "Revise os maiores custos e a política de venda para recuperar margem.",
    link: { label: "Atualizar custos", to: "/custos" },
  },
  spread: {
    action: "Compare os resultados por cultura e simule uma redistribuição de custos.",
    link: { label: "Simular solução", to: "/simulador" },
  },
  custo_alto: {
    action: "Audite os custos da cultura apontada e renegocie os maiores itens.",
    link: { label: "Atualizar custos", to: "/custos" },
  },
  neg_fields: {
    action: "Audite os custos dos talhões com prejuízo antes da próxima safra.",
    link: { label: "Atualizar custos", to: "/custos" },
  },
  custo_ha: {
    action: "Compare o custo por hectare entre talhões e corrija os desvios.",
    link: { label: "Atualizar custos", to: "/custos" },
  },
  breakeven: {
    action: "Reduza custos ou reveja a produtividade estimada para folgar o ponto de equilíbrio.",
    link: { label: "Simular solução", to: "/simulador" },
  },
  missing_price: {
    action: "Cadastre o preço das culturas para que o resultado seja calculado corretamente.",
    link: { label: "Atualizar preços", to: "/precos" },
  },
  missing_cost: {
    action: "Lance os custos dos talhões sem despesas registradas.",
    link: { label: "Atualizar custos", to: "/custos" },
  },
};

function actionFor(key: string): { action: string; link?: ActionLink } {
  if (ACTION_BY_KEY[key]) return ACTION_BY_KEY[key];
  if (key.startsWith("dep:"))
    return {
      action: "Avalie estratégias para reduzir a concentração do resultado.",
      link: { label: "Simular solução", to: "/simulador" },
    };
  return { action: "Revise os dados desta penalidade no diagnóstico.", link: { label: "Ver Diagnóstico", to: "/diagnostico" } };
}

function pct(v: number) {
  return `${NUM.format(v)}%`;
}

/* --------------------------- snapshot builder --------------------------- */

export function buildIntelligenceSnapshot(input: IntelligenceInput) {
  const fields = input.fields ?? [];
  const costs = input.costs ?? [];
  const prices = input.prices ?? [];
  const diagnostics = [...(input.diagnostics ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  const scenarios = input.scenarios ?? [];

  const farm = aggregateFarm(fields, costs, prices);
  const metrics = computeMetrics(farm);
  const live = computeScoreBreakdown(farm);

  const latest = diagnostics[0] ?? null;
  const previous = diagnostics[1] ?? null;

  const breakdown: ScoreBreakdownEntry[] =
    (latest?.report?.scoreBreakdown && latest.report.scoreBreakdown.length > 0
      ? latest.report.scoreBreakdown
      : live.breakdown) ?? [];

  const score = latest ? n(latest.health_score) : live.score;

  return {
    propertyName: input.properties?.[0]?.name ?? null,
    propertiesCount: (input.properties ?? []).length,
    hasFields: fields.length > 0,
    hasCosts: costs.length > 0,
    hasPrices: prices.length > 0,
    farm,
    metrics,
    live,
    score,
    breakdown,
    latest,
    previous,
    diagnostics,
    scenarios,
    lastAnalysisAt: latest?.created_at ?? null,
  };
}

export type IntelligenceSnapshot = ReturnType<typeof buildIntelligenceSnapshot>;

/* --------------------------- primary problem --------------------------- */

export function getPrimaryProblem(snap: IntelligenceSnapshot): PrimaryProblem {
  const negatives = snap.breakdown
    .map((b) => ({ b, r: ruleKeyOf(b.label) }))
    .filter((x) => x.r !== null && n(x.b.points) < 0) as {
    b: ScoreBreakdownEntry;
    r: { key: string; display: string };
  }[];
  if (negatives.length === 0) return null;
  negatives.sort((a, b) => n(a.b.points) - n(b.b.points));
  const top = negatives[0];
  const { action, link } = actionFor(top.r.key);
  return {
    key: top.r.key,
    title: top.r.display,
    detail: top.b.label,
    points: n(top.b.points),
    action,
    link,
  };
}

/* ------------------------- primary opportunity ------------------------- */

export function getPrimaryOpportunity(snap: IntelligenceSnapshot): PrimaryOpportunity {
  const current = snap.score;
  const currentProfit = n(snap.metrics.profit);

  // 1. Best saved scenario scoring above the current score.
  const better = snap.scenarios
    .filter((s) => n(s.simulated_score) > current)
    .sort((a, b) => {
      const d = n(b.simulated_score) - n(a.simulated_score);
      if (d !== 0) return d;
      return n(b.metrics_snapshot?.profit as number) - n(a.metrics_snapshot?.profit as number);
    })[0];
  if (better) {
    const profit = n(better.metrics_snapshot?.profit as number);
    return {
      source: "scenario",
      title: `Cenário "${better.name}"`,
      detail: "Cenário salvo com nota superior à situação atual.",
      currentScore: current,
      simulatedScore: n(better.simulated_score),
      scorePotential: n(better.simulated_score) - current,
      profitDelta: profit ? profit - currentProfit : undefined,
      scenarioId: better.id,
      link: { label: "Ver cenário", to: "/simulador" },
    };
  }

  // 2. A simulation that reduces the main penalty, even without a better score.
  const problem = getPrimaryProblem(snap);
  if (problem) {
    const relief = snap.scenarios
      .filter((s) => (s.score_breakdown ?? []).length > 0)
      .map((s) => {
        const pts = (s.score_breakdown ?? [])
          .filter((b) => ruleKeyOf(b.label)?.key === problem.key)
          .reduce((acc, b) => acc + n(b.points), 0);
        return { s, gain: pts - problem.points };
      })
      .filter((x) => x.gain > 0)
      .sort((a, b) => b.gain - a.gain)[0];
    if (relief) {
      return {
        source: "penalty",
        title: `Cenário "${relief.s.name}" reduz "${problem.title}"`,
        detail: `A penalidade cai de ${problem.points} para ${problem.points + relief.gain} pontos nessa simulação.`,
        currentScore: current,
        simulatedScore: n(relief.s.simulated_score),
        scorePotential: relief.gain,
        scenarioId: relief.s.id,
        link: { label: "Ver cenário", to: "/simulador" },
      };
    }
  }

  // 3. First opportunity registered in the latest diagnostic.
  const opp = (snap.latest?.report?.opportunities ?? []).find((o) => o && o.trim().length > 0);
  if (opp) {
    return {
      source: "diagnostic",
      title: "Oportunidade do último diagnóstico",
      detail: opp,
      currentScore: current,
      link: { label: "Ver Diagnóstico", to: "/diagnostico" },
    };
  }
  return null;
}

/* ----------------------------- next action ----------------------------- */

export function getNextAction(snap: IntelligenceSnapshot): NextAction {
  const plan = (snap.latest?.report?.actionPlan ?? []).filter((a) => a && a.trim().length > 0);
  if (!snap.latest || plan.length === 0) {
    return {
      available: false,
      action: "Gere seu primeiro diagnóstico para receber uma próxima ação recomendada.",
      reason: "",
      link: { label: "Gerar Diagnóstico", to: "/diagnostico" },
    };
  }
  const problem = getPrimaryProblem(snap);
  return {
    available: true,
    action: plan[0],
    reason: problem ? problem.detail : snap.latest.report?.scoreReason ?? "",
    link: { label: "Ver Diagnóstico", to: "/diagnostico" },
  };
}

/* ------------------------------ evolution ------------------------------ */

export function getEvolution(snap: IntelligenceSnapshot): Evolution {
  if (!snap.latest || !snap.previous) {
    return {
      available: false,
      message: "Precisamos de pelo menos dois diagnósticos para calcular sua evolução.",
      causes: [],
    };
  }
  const cur = snap.latest.report?.scoreBreakdown ?? [];
  const prev = snap.previous.report?.scoreBreakdown ?? [];
  const byKey = new Map<string, { display: string; curPts: number; prevPts: number }>();
  const acc = (list: ScoreBreakdownEntry[], side: "cur" | "prev") => {
    for (const b of list) {
      const r = ruleKeyOf(b.label);
      if (!r) continue;
      const row = byKey.get(r.key) ?? { display: r.display, curPts: 0, prevPts: 0 };
      row.display = r.display;
      if (side === "cur") row.curPts += n(b.points);
      else row.prevPts += n(b.points);
      byKey.set(r.key, row);
    }
  };
  acc(prev, "prev");
  acc(cur, "cur");
  const causes = Array.from(byKey.values())
    .map((r) => ({ display: r.display, impact: r.curPts - r.prevPts }))
    .filter((r) => r.impact !== 0)
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 2);

  return {
    available: true,
    current: n(snap.latest.health_score),
    previous: n(snap.previous.health_score),
    delta: n(snap.latest.health_score) - n(snap.previous.health_score),
    causes,
  };
}

/* --------------------------- priority alerts --------------------------- */

const SEV_ORDER: Record<Alert["severity"], number> = { critical: 0, high: 1, medium: 2 };

export function getPriorityAlerts(
  snap: IntelligenceSnapshot,
  max = 3,
  includePrimaryProblem = false,
): Alert[] {
  const alerts: Alert[] = [];
  const farm = snap.farm;
  const m = snap.metrics;

  // Talhões com lucro negativo
  const negFields = farm.perField.filter((f) => f.profit < 0);
  if (negFields.length > 0) {
    const worst = negFields.reduce((a, b) => (b.profit < a.profit ? b : a));
    alerts.push({
      key: "neg_fields",
      severity: "critical",
      title: "Talhão com lucro negativo",
      reason: `${negFields.length} talhão(ões) fecham com prejuízo — o pior é ${worst.field.name}.`,
      metric: `${worst.field.name}: ${BRL.format(worst.profit)}`,
      impact: `-25 pontos por talhão negativo na nota`,
      action: "Audite os custos operacionais desses talhões antes da próxima safra.",
      link: { label: "Atualizar custos", to: "/custos" },
    });
  }

  // Ponto de equilíbrio acima de 80% da produtividade estimada
  const beRisky = farm.perField
    .map((f) => {
      const est = Number(f.field.estimated_yield ?? 0);
      const ratio = est > 0 && f.breakevenBagPerHa > 0 ? (f.breakevenBagPerHa / est) * 100 : 0;
      return { f, ratio };
    })
    .filter((x) => x.ratio > 80)
    .sort((a, b) => b.ratio - a.ratio);
  if (beRisky.length > 0) {
    alerts.push({
      key: "breakeven",
      severity: "critical",
      title: "Ponto de equilíbrio muito alto",
      reason: `Em ${beRisky.length} talhão(ões) o ponto de equilíbrio passa de 80% da produtividade estimada.`,
      metric: `${beRisky[0].f.field.name}: ${pct(beRisky[0].ratio)} da produtividade`,
      impact: "-20 pontos por talhão nessa faixa",
      action: "Reduza custos ou revise a produtividade estimada desses talhões.",
      link: { label: "Simular solução", to: "/simulador" },
    });
  }

  // Dependência de uma cultura acima de 70%
  if (n(m.depPct) > 70) {
    alerts.push({
      key: `dep:${m.topCrop}`,
      severity: "high",
      title: `Dependência excessiva de ${m.topCrop || "uma cultura"}`,
      reason: "O resultado da fazenda está concentrado em uma única cultura.",
      metric: `${pct(n(m.depPct))} do lucro`,
      impact: "-15 a -20 pontos na nota",
      action: "Avalie estratégias para reduzir a concentração do resultado.",
      link: { label: "Simular solução", to: "/simulador" },
    });
  }

  // Margem líquida abaixo de 20%
  if (farm.totalRevenue > 0 && n(m.margin) < 20) {
    alerts.push({
      key: "margem",
      severity: n(m.margin) < 10 ? "critical" : "high",
      title: "Margem líquida baixa",
      reason: "A margem líquida está abaixo do patamar saudável de 20%.",
      metric: `Margem de ${pct(n(m.margin))}`,
      impact: n(m.margin) < 10 ? "-20 pontos na nota" : "-10 pontos na nota",
      action: "Revise os maiores custos e a política de comercialização.",
      link: { label: "Atualizar custos", to: "/custos" },
    });
  }

  // Custo/ha muito acima da média
  const withArea = farm.perField.filter((f) => f.area > 0);
  if (withArea.length > 1) {
    const mean = withArea.reduce((s, f) => s + f.costPerHa, 0) / withArea.length;
    if (mean > 0) {
      const over = withArea
        .map((f) => ({ f, over: ((f.costPerHa - mean) / mean) * 100 }))
        .filter((x) => x.over >= 20)
        .sort((a, b) => b.over - a.over);
      if (over.length > 0) {
        alerts.push({
          key: "custo_ha",
          severity: over[0].over > 35 ? "high" : "medium",
          title: "Custo por hectare acima da média",
          reason: `${over.length} talhão(ões) gastam bem mais por hectare que a média da fazenda.`,
          metric: `${over[0].f.field.name}: ${BRL.format(over[0].f.costPerHa)}/ha (+${pct(over[0].over)})`,
          impact: over[0].over > 35 ? "-20 pontos por talhão" : "-10 pontos por talhão",
          action: "Audite os custos operacionais desses talhões.",
          link: { label: "Atualizar custos", to: "/custos" },
        });
      }
    }
  }

  // Queda relevante da nota
  const evo = getEvolution(snap);
  if (evo.available && n(evo.delta) <= -5) {
    alerts.push({
      key: "score_drop",
      severity: n(evo.delta) <= -15 ? "high" : "medium",
      title: "Queda na Nota de Saúde Financeira",
      reason: "A nota caiu em relação ao diagnóstico anterior.",
      metric: `${evo.previous} → ${evo.current}`,
      impact: `${evo.delta} pontos`,
      action: "Revise as causas da queda no diagnóstico e corrija os pontos apontados.",
      link: { label: "Ver Diagnóstico", to: "/diagnostico" },
    });
  }

  // Dados faltando
  const cropsInFields = Array.from(new Set(farm.perField.map((f) => f.field.crop)));
  const missingPrice = cropsInFields.filter((c) => !(farm.priceByCrop[c] > 0));
  if (missingPrice.length > 0) {
    alerts.push({
      key: "missing_price",
      severity: "medium",
      title: "Falta de preço cadastrado",
      reason: "Sem preço não é possível calcular receita e margem dessas culturas.",
      metric: missingPrice.join(", "),
      impact: "-15 pontos na nota",
      action: "Cadastre o preço por saca dessas culturas.",
      link: { label: "Atualizar preços", to: "/precos" },
    });
  }
  const missingCost = farm.perField.filter((f) => f.totalCost <= 0);
  if (missingCost.length > 0) {
    alerts.push({
      key: "missing_cost",
      severity: "medium",
      title: "Falta de custo cadastrado",
      reason: "Talhões sem custos lançados distorcem o resultado da fazenda.",
      metric: missingCost.map((f) => f.field.name).join(", "),
      impact: "-15 pontos na nota",
      action: "Lance os custos desses talhões.",
      link: { label: "Atualizar custos", to: "/custos" },
    });
  }

  // Deduplicação: nunca repetir o "Principal problema".
  const problem = getPrimaryProblem(snap);
  const deduped = includePrimaryProblem
    ? alerts
    : alerts.filter((a) => !problem || a.key !== problem.key);

  deduped.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const seen = new Set<string>();
  const unique = deduped.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)));
  return unique.slice(0, max);
}

/* ---------------------------- priority level ---------------------------- */

export function getPriorityLevel(snap: IntelligenceSnapshot, alerts: Alert[]): Severity {
  if (alerts.some((a) => a.severity === "critical")) return "critical";
  if (alerts.some((a) => a.severity === "high")) return "high";
  if (alerts.length > 0) return "medium";
  const problem = getPrimaryProblem(snap);
  if (problem && problem.points <= -20) return "high";
  if (problem) return "medium";
  return "positive";
}
