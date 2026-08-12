// Persistência de alertas — camada PURA e determinística.
// Não calcula nenhuma métrica financeira nova: apenas converte os alertas já
// produzidos por src/lib/intelligence.ts em registros persistíveis e concilia
// esses registros com o que já está salvo no banco.
import { getPriorityAlerts, type Alert, type IntelligenceSnapshot } from "@/lib/intelligence";

export type AlertStatus = "active" | "acknowledged" | "resolved";
export type PersistSeverity = "critical" | "high" | "medium";

export type PersistableAlert = {
  alert_key: string;
  property_id: string | null;
  severity: PersistSeverity;
  title: string;
  message: string;
  metric_name: string | null;
  metric_value: string | null;
  impact: string | null;
  action_label: string | null;
  action_route: string | null;
};

export type ExistingAlert = {
  id: string;
  alert_key: string;
  status: AlertStatus;
  severity: PersistSeverity;
  title: string;
  message: string;
  metric_value: string | null;
  previous_value: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type AlertInsert = PersistableAlert & {
  status: "active";
  previous_value: null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: null;
};

export type AlertUpdate = {
  id: string;
  patch: Record<string, unknown>;
};

export type Reconciliation = {
  inserts: AlertInsert[];
  updates: AlertUpdate[];
};

/** Todos os alertas persistíveis (severidade critical/high/medium). "positive" nunca vira alerta. */
export function buildPersistableAlerts(
  snap: IntelligenceSnapshot,
  propertyId: string | null,
): PersistableAlert[] {
  const alerts: Alert[] = getPriorityAlerts(snap, Number.MAX_SAFE_INTEGER);
  return alerts.map((a) => ({
    alert_key: `${a.key}:${propertyId ?? "fazenda"}`,
    property_id: propertyId,
    severity: a.severity,
    title: a.title,
    message: a.reason,
    metric_name: a.title,
    metric_value: a.metric ?? null,
    impact: a.impact ?? null,
    action_label: a.link?.label ?? null,
    action_route: a.link?.to ?? null,
  }));
}

/**
 * Deduplicação por alert_key:
 * - novo  -> insert (active)
 * - ativo/reconhecido -> atualiza last_seen_at, métrica e valor anterior (mantém first_seen_at)
 * - resolvido e voltou -> reativa mantendo o histórico de first_seen_at
 * - sumiu -> resolvido automaticamente com resolved_at
 */
export function reconcileAlerts(
  existing: ExistingAlert[],
  incoming: PersistableAlert[],
  nowISO: string,
): Reconciliation {
  const byKey = new Map(existing.map((e) => [e.alert_key, e]));
  const inserts: AlertInsert[] = [];
  const updates: AlertUpdate[] = [];
  const seen = new Set<string>();

  for (const a of incoming) {
    if (seen.has(a.alert_key)) continue;
    seen.add(a.alert_key);
    const prev = byKey.get(a.alert_key);
    if (!prev) {
      inserts.push({
        ...a,
        status: "active",
        previous_value: null,
        first_seen_at: nowISO,
        last_seen_at: nowISO,
        resolved_at: null,
      });
      continue;
    }
    const changed = prev.metric_value !== a.metric_value;
    const patch: Record<string, unknown> = {
      severity: a.severity,
      title: a.title,
      message: a.message,
      metric_name: a.metric_name,
      metric_value: a.metric_value,
      previous_value: changed ? prev.metric_value : prev.previous_value,
      impact: a.impact,
      action_label: a.action_label,
      action_route: a.action_route,
      property_id: a.property_id,
      last_seen_at: nowISO,
    };
    if (prev.status === "resolved") {
      // Reativação: mantém first_seen_at original.
      patch['status'] = "active";
      patch['resolved_at'] = null;
    }
    updates.push({ id: prev.id, patch });
  }

  for (const e of existing) {
    if (seen.has(e.alert_key)) continue;
    if (e.status === "resolved") continue;
    updates.push({
      id: e.id,
      patch: { status: "resolved", resolved_at: nowISO },
    });
  }

  return { inserts, updates };
}

/** Badge do menu: apenas alertas ativos e não reconhecidos. */
export function countUnacknowledged(alerts: { status: AlertStatus }[]): number {
  return alerts.filter((a) => a.status === "active").length;
}

export function durationLabel(startISO: string, endISO: string): string {
  const ms = Math.max(0, new Date(endISO).getTime() - new Date(startISO).getTime());
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} dia${days > 1 ? "s" : ""}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hora${hours > 1 ? "s" : ""}`;
  const mins = Math.floor(ms / 60_000);
  return `${mins} minuto${mins === 1 ? "" : "s"}`;
}
