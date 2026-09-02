// Server-only: reavalia e persiste os alertas inteligentes do usuário.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildIntelligenceSnapshot,
  type DiagnosticLite,
  type ScenarioLite,
} from "@/lib/intelligence";
import {
  buildPersistableAlerts,
  reconcileAlerts,
  type ExistingAlert,
} from "@/lib/alerts-rules";
import { recordAuditEvent } from "@/lib/audit.server";

type DB = SupabaseClient<Database>;

/**
 * Evita sincronizações concorrentes/duplicadas para o mesmo usuário:
 * chamadas simultâneas compartilham a mesma promise em vez de disparar
 * cascatas de resync. Não há polling — a sincronização segue orientada a eventos.
 */
const inFlight = new Map<string, Promise<{ created: number; updated: number }>>();

export function syncAlertsFor(supabase: DB, userId: string) {
  const running = inFlight.get(userId);
  if (running) return running;
  const p = runSync(supabase, userId).finally(() => {
    inFlight.delete(userId);
  });
  inFlight.set(userId, p);
  return p;
}

async function runSync(supabase: DB, userId: string) {
  const [properties, fields, costs, prices, diagnostics, scenarios, existing] = await Promise.all([
    supabase.from("properties").select("*").order("created_at", { ascending: true }),
    supabase.from("fields").select("*"),
    supabase.from("costs").select("*"),
    supabase.from("prices").select("*"),
    supabase.from("diagnostics").select("*").order("created_at", { ascending: false }).limit(10),
    supabase.from("simulated_scenarios").select("*").order("created_at", { ascending: false }),
    supabase.from("intelligence_alerts").select("*"),
  ]);

  const snap = buildIntelligenceSnapshot({
    properties: (properties.data ?? []) as { id?: string; name: string }[],
    fields: (fields.data ?? []) as never,
    costs: (costs.data ?? []) as never,
    prices: (prices.data ?? []) as never,
    diagnostics: (diagnostics.data ?? []) as unknown as DiagnosticLite[],
    scenarios: (scenarios.data ?? []) as unknown as ScenarioLite[],
  });

  const propertyId = (properties.data?.[0]?.id as string | undefined) ?? null;
  const incoming = buildPersistableAlerts(snap, propertyId);
  const { inserts, updates } = reconcileAlerts(
    (existing.data ?? []) as unknown as ExistingAlert[],
    incoming,
    new Date().toISOString(),
  );

  if (inserts.length > 0) {
    const { error } = await supabase
      .from("intelligence_alerts")
      .insert(inserts.map((i) => ({ ...i, user_id: userId })) as never);
    if (error) throw new Error(error.message);
  }
  for (const u of updates) {
    const { error } = await supabase
      .from("intelligence_alerts")
      .update(u.patch as never)
      .eq("id", u.id);
    if (error) throw new Error(error.message);
    // Auditoria de transições relevantes (sem conteúdo do alerta).
    const nextStatus = u.patch['status'] as string | undefined;
    if (nextStatus === "resolved") {
      await recordAuditEvent(supabase, {
        eventType: "alert_resolved_automatically",
        entityType: "alert",
        entityId: u.id,
        metadata: { source: "alerts_sync" },
      });
    } else if (nextStatus === "active") {
      await recordAuditEvent(supabase, {
        eventType: "alert_reactivated",
        entityType: "alert",
        entityId: u.id,
        metadata: { source: "alerts_sync" },
      });
    }
  }

  return { created: inserts.length, updated: updates.length };
}

/** Reavaliação disparada por mudanças de dados — nunca quebra a operação principal. */
export async function resyncAlerts(supabase: DB, userId: string) {
  try {
    await syncAlertsFor(supabase, userId);
  } catch (err) {
    console.error("[alertas] falha ao reavaliar alertas", (err as Error).message);
  }
}
