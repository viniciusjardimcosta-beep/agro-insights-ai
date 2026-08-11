import { describe, expect, it } from "vitest";
import {
  buildIntelligenceSnapshot,
  getEvolution,
  getNextAction,
  getPrimaryOpportunity,
  getPrimaryProblem,
  getPriorityAlerts,
  getPriorityLevel,
  type IntelligenceInput,
} from "./intelligence";

const field = (over: Partial<IntelligenceInput["fields"][number]> = {}) => ({
  id: "f1",
  name: "Talhão 1",
  area: 100,
  crop: "soja",
  estimated_yield: 60,
  real_yield: null,
  ...over,
});

const base = (over: Partial<IntelligenceInput> = {}): IntelligenceInput => ({
  properties: [{ name: "Fazenda Teste" }],
  fields: [field()],
  costs: [{ field_id: "f1", category: "Sementes", amount: 100000 }],
  prices: [{ crop: "soja", price_per_bag: 120, date: "2026-01-01" }],
  diagnostics: [],
  scenarios: [],
  ...over,
});

const diag = (id: string, score: number, report: Record<string, unknown>, created_at: string) => ({
  id,
  created_at,
  health_score: score,
  report: report as never,
});

describe("intelligence", () => {
  it("não quebra sem nenhum dado", () => {
    const snap = buildIntelligenceSnapshot(
      base({ properties: [], fields: [], costs: [], prices: [] }),
    );
    expect(() => getPrimaryProblem(snap)).not.toThrow();
    expect(getPriorityAlerts(snap)).toBeInstanceOf(Array);
    expect(getNextAction(snap).available).toBe(false);
    expect(getEvolution(snap).available).toBe(false);
  });

  it("seleciona a maior penalidade como principal problema", () => {
    const snap = buildIntelligenceSnapshot(
      base({
        diagnostics: [
          diag("d1", 53, {
            scoreBreakdown: [
              { label: "Base inicial", points: 100 },
              { label: "Margem líquida 12.0% (10% a 20%)", points: -10 },
              { label: "Dependência da cultura milho 70.4% do lucro (70% a 80%)", points: -15 },
              { label: "Falta de preço cadastrado (trigo)", points: -15 },
              { label: "Ajuste para piso de 0", points: -50 },
            ],
          }, "2026-02-01T00:00:00Z"),
        ],
      }),
    );
    const p = getPrimaryProblem(snap);
    expect(p?.key).toBe("dep:milho");
    expect(p?.points).toBe(-15);
    expect(p?.action).toContain("concentração");
  });

  it("escolhe o melhor cenário salvo acima da nota atual e ignora piores", () => {
    const snap = buildIntelligenceSnapshot(
      base({
        diagnostics: [diag("d1", 53, { scoreBreakdown: [] }, "2026-02-01T00:00:00Z")],
        scenarios: [
          { id: "s1", name: "Pior", created_at: "2026-02-02", simulated_score: 40, score_breakdown: [], metrics_snapshot: { profit: 1000 } },
          { id: "s2", name: "Redução custo soja", created_at: "2026-02-03", simulated_score: 68, score_breakdown: [], metrics_snapshot: { profit: 90000 } },
          { id: "s3", name: "Médio", created_at: "2026-02-04", simulated_score: 60, score_breakdown: [], metrics_snapshot: { profit: 50000 } },
        ],
      }),
    );
    const o = getPrimaryOpportunity(snap);
    expect(o?.source).toBe("scenario");
    expect(o?.scenarioId).toBe("s2");
    expect(o?.scorePotential).toBe(15);
  });

  it("cenário pior não vira oportunidade; cai para o diagnóstico", () => {
    const snap = buildIntelligenceSnapshot(
      base({
        diagnostics: [
          diag("d1", 80, { scoreBreakdown: [], opportunities: ["Renegociar fertilizantes"] }, "2026-02-01T00:00:00Z"),
        ],
        scenarios: [
          { id: "s1", name: "Pior", created_at: "2026-02-02", simulated_score: 40, score_breakdown: [], metrics_snapshot: { profit: 10 } },
        ],
      }),
    );
    const o = getPrimaryOpportunity(snap);
    expect(o?.source).toBe("diagnostic");
    expect(o?.detail).toBe("Renegociar fertilizantes");
  });

  it("talhão negativo gera alerta crítico", () => {
    const snap = buildIntelligenceSnapshot(
      base({ costs: [{ field_id: "f1", category: "Diesel", amount: 5_000_000 }] }),
    );
    const alerts = getPriorityAlerts(snap);
    expect(alerts.some((a) => a.key === "neg_fields" && a.severity === "critical")).toBe(true);
    expect(getPriorityLevel(snap, alerts)).toBe("critical");
  });

  it("margem abaixo de 20% gera alerta", () => {
    // receita 100*60*120 = 720.000; custo 620.000 => margem ~13.9%
    const snap = buildIntelligenceSnapshot(
      base({ costs: [{ field_id: "f1", category: "Diesel", amount: 620000 }] }),
    );
    const alerts = getPriorityAlerts(snap);
    expect(alerts.some((a) => a.key === "margem")).toBe(true);
  });

  it("não duplica o principal problema nos alertas", () => {
    const snap = buildIntelligenceSnapshot(
      base({
        costs: [{ field_id: "f1", category: "Diesel", amount: 620000 }],
        diagnostics: [
          diag("d1", 50, {
            scoreBreakdown: [{ label: "Margem líquida 13.9% (10% a 20%)", points: -10 }],
          }, "2026-02-01T00:00:00Z"),
        ],
      }),
    );
    expect(getPrimaryProblem(snap)?.key).toBe("margem");
    expect(getPriorityAlerts(snap).some((a) => a.key === "margem")).toBe(false);
  });

  it("limita a 3 alertas", () => {
    const snap = buildIntelligenceSnapshot(
      base({
        fields: [
          field({ id: "f1", name: "T1" }),
          field({ id: "f2", name: "T2", crop: "milho" }),
        ],
        costs: [{ field_id: "f1", category: "Diesel", amount: 900000 }],
        prices: [],
      }),
    );
    expect(getPriorityAlerts(snap).length).toBeLessThanOrEqual(3);
  });

  it("nota alta sem penalidades gera estado positivo", () => {
    const snap = buildIntelligenceSnapshot(
      base({
        diagnostics: [diag("d1", 100, { scoreBreakdown: [{ label: "Base inicial", points: 100 }] }, "2026-02-01T00:00:00Z")],
        costs: [{ field_id: "f1", category: "Sementes", amount: 100000 }],
      }),
    );
    const alerts = getPriorityAlerts(snap);
    expect(alerts).toHaveLength(0);
    expect(getPrimaryProblem(snap)).toBeNull();
    expect(getPriorityLevel(snap, alerts)).toBe("positive");
  });

  it("evolução compara com o diagnóstico imediatamente anterior", () => {
    const snap = buildIntelligenceSnapshot(
      base({
        diagnostics: [
          diag("d2", 53, {
            scoreBreakdown: [{ label: "Margem líquida 12.0% (10% a 20%)", points: -10 }],
          }, "2026-02-10T00:00:00Z"),
          diag("d1", 63, { scoreBreakdown: [] }, "2026-01-10T00:00:00Z"),
        ],
      }),
    );
    const evo = getEvolution(snap);
    expect(evo.available).toBe(true);
    expect(evo.delta).toBe(-10);
    expect(evo.causes[0]).toEqual({ display: "Margem líquida baixa", impact: -10 });
  });

  it("próxima ação usa a primeira ação do plano do último diagnóstico", () => {
    const snap = buildIntelligenceSnapshot(
      base({
        diagnostics: [
          diag("d1", 53, { actionPlan: ["Auditar os custos operacionais do Talhão 1."] }, "2026-02-01T00:00:00Z"),
        ],
      }),
    );
    expect(getNextAction(snap).action).toBe("Auditar os custos operacionais do Talhão 1.");
  });
});
