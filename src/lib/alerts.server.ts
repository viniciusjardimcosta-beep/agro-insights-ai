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

type DB = SupabaseClient<Database>;

export async function syncAlertsFor(supabase: DB, userId: string) {
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
  }

  return { created: inserts.length, updated: updates.length };
}
