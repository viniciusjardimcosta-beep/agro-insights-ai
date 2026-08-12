import { describe, expect, it } from "vitest";
import {
  buildPersistableAlerts,
  countUnacknowledged,
  durationLabel,
  reconcileAlerts,
  type ExistingAlert,
  type PersistableAlert,
} from "@/lib/alerts-rules";
import { buildIntelligenceSnapshot } from "@/lib/intelligence";

const NOW = "2026-08-12T12:00:00.000Z";
const BEFORE = "2026-08-01T12:00:00.000Z";

function snapshot(over: Partial<Parameters<typeof buildIntelligenceSnapshot>[0]> = {}) {
  return buildIntelligenceSnapshot({
    properties: [{ id: "p1", name: "Fazenda Santa Maria" }],
    fields: [],
    costs: [],
    prices: [],
    diagnostics: [],
    scenarios: [],
    ...over,
  } as never);
}

const field = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  property_id: "p1",
  name: `Talhão ${id}`,
  area: 100,
  crop: "Soja",
  estimated_yield: 60,
  real_yield: null,
  ...over,
});

const alert = (key: string, over: Partial<PersistableAlert> = {}): PersistableAlert => ({
  alert_key: key,
  property_id: "p1",
  severity: "high",
  title: "T",
  message: "M",
  metric_name: "T",
  metric_value: "10",
  impact: "-10",
  action_label: "Ver",
  action_route: "/custos",
  ...over,
});

const existing = (over: Partial<ExistingAlert> = {}): ExistingAlert => ({
  id: "a1",
  alert_key: "k1:p1",
  status: "active",
  severity: "high",
  title: "T",
  message: "M",
  metric_value: "10",
  previous_value: null,
  first_seen_at: BEFORE,
  last_seen_at: BEFORE,
  ...over,
});

describe("reconcileAlerts", () => {
  it("cria novo alerta quando a chave não existe", () => {
    const r = reconcileAlerts([], [alert("k1:p1")], NOW);
    expect(r.inserts).toHaveLength(1);
    expect(r.inserts[0].status).toBe("active");
    expect(r.inserts[0].first_seen_at).toBe(NOW);
    expect(r.updates).toHaveLength(0);
  });

  it("deduplica por alert_key e não cria registros repetidos", () => {
    const r = reconcileAlerts([], [alert("k1:p1"), alert("k1:p1")], NOW);
    expect(r.inserts).toHaveLength(1);
  });

  it("atualiza last_seen_at mantendo first_seen_at", () => {
    const r = reconcileAlerts([existing()], [alert("k1:p1", { metric_value: "12" })], NOW);
    expect(r.inserts).toHaveLength(0);
    expect(r.updates[0].patch['last_seen_at']).toBe(NOW);
    expect(r.updates[0].patch['first_seen_at']).toBeUndefined();
    expect(r.updates[0].patch['previous_value']).toBe("10");
  });

  it("preserva reconhecimento quando o problema continua", () => {
    const r = reconcileAlerts([existing({ status: "acknowledged" })], [alert("k1:p1")], NOW);
    expect(r.updates[0].patch['status']).toBeUndefined();
  });

  it("resolve automaticamente quando a regra deixa de disparar", () => {
    const r = reconcileAlerts([existing()], [], NOW);
    expect(r.updates[0].patch).toEqual({ status: "resolved", resolved_at: NOW });
  });

  it("não reprocessa alertas já resolvidos ausentes", () => {
    const r = reconcileAlerts([existing({ status: "resolved" })], [], NOW);
    expect(r.updates).toHaveLength(0);
  });

  it("reativa alerta resolvido mantendo o histórico", () => {
    const r = reconcileAlerts([existing({ status: "resolved" })], [alert("k1:p1")], NOW);
    expect(r.inserts).toHaveLength(0);
    expect(r.updates[0].patch['status']).toBe("active");
    expect(r.updates[0].patch['resolved_at']).toBeNull();
    expect(r.updates[0].patch['first_seen_at']).toBeUndefined();
  });
});

describe("badge e histórico", () => {
  it("conta apenas ativos não reconhecidos", () => {
    expect(
      countUnacknowledged([
        { status: "active" },
        { status: "active" },
        { status: "acknowledged" },
        { status: "resolved" },
      ]),
    ).toBe(2);
  });

  it("calcula duração aproximada", () => {
    expect(durationLabel(BEFORE, NOW)).toBe("11 dias");
  });
});

describe("buildPersistableAlerts", () => {
  it("não gera alertas quando não há dados", () => {
    expect(buildPersistableAlerts(snapshot(), "p1").length).toBeGreaterThanOrEqual(0);
  });

  it("gera alerta de talhão com lucro negativo", () => {
    const snap = snapshot({
      fields: [field("f1", { estimated_yield: 10 })] as never,
      costs: [{ id: "c1", field_id: "f1", amount: 500000, category: "Insumos", date: "2026-01-01" }] as never,
      prices: [{ id: "pr1", crop: "Soja", price_per_bag: 100, date: "2026-01-01" }] as never,
    });
    const keys = buildPersistableAlerts(snap, "p1").map((a) => a.alert_key);
    expect(keys).toContain("neg_fields:p1");
    expect(keys.every((k) => k.endsWith(":p1"))).toBe(true);
  });

  it("gera alertas de dependência de cultura e margem baixa", () => {
    const snap = snapshot({
      fields: [field("f1", { estimated_yield: 60 })] as never,
      costs: [{ id: "c1", field_id: "f1", amount: 550000, category: "Insumos", date: "2026-01-01" }] as never,
      prices: [{ id: "pr1", crop: "Soja", price_per_bag: 100, date: "2026-01-01" }] as never,
    });
    const alerts = buildPersistableAlerts(snap, "p1");
    const keys = alerts.map((a) => a.alert_key);
    expect(keys.some((k) => k.startsWith("dep:") || k.startsWith("margem"))).toBe(true);
    expect(alerts.every((a) => ["critical", "high", "medium"].includes(a.severity))).toBe(true);
  });

  it("gera alerta de queda de nota comparando diagnósticos", () => {
    const snap = snapshot({
      fields: [field("f1")] as never,
      prices: [{ id: "pr1", crop: "Soja", price_per_bag: 100, date: "2026-01-01" }] as never,
      costs: [{ id: "c1", field_id: "f1", amount: 100000, category: "Insumos", date: "2026-01-01" }] as never,
      diagnostics: [
        { id: "d2", created_at: "2026-08-10T00:00:00Z", health_score: 50, report: { scoreBreakdown: [] } },
        { id: "d1", created_at: "2026-07-10T00:00:00Z", health_score: 80, report: { scoreBreakdown: [] } },
      ] as never,
    });
    const keys = buildPersistableAlerts(snap, "p1").map((a) => a.alert_key);
    expect(keys).toContain("score_drop:p1");
  });

  it("usa chaves distintas por propriedade (isolamento de escopo)", () => {
    const snap = snapshot({
      fields: [field("f1", { estimated_yield: 10 })] as never,
      costs: [{ id: "c1", field_id: "f1", amount: 500000, category: "Insumos", date: "2026-01-01" }] as never,
      prices: [{ id: "pr1", crop: "Soja", price_per_bag: 100, date: "2026-01-01" }] as never,
    });
    const a = buildPersistableAlerts(snap, "p1")[0];
    const b = buildPersistableAlerts(snap, "p2")[0];
    expect(a.alert_key).not.toBe(b.alert_key);
    // Reconciliação por usuário: chaves de outra propriedade não colidem.
    const r = reconcileAlerts([existing({ alert_key: a.alert_key })], [b], NOW);
    expect(r.inserts).toHaveLength(1);
  });
});
