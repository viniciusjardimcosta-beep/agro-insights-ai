import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAuditEvent } from "@/lib/audit.server";

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };
export type ScoreBreakdown = { label: string; points: number }[];
export type JsonObject = { [k: string]: Json };

export type SimulatedScenarioRow = {
  id: string;
  user_id: string;
  property_id: string | null;
  name: string;
  scenario_data: JsonObject;
  metrics_snapshot: JsonObject;
  score_breakdown: ScoreBreakdown;
  simulated_score: number;
  created_at: string;
};

export const listScenarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("simulated_scenarios")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SimulatedScenarioRow[];
  });

const createInput = z.object({
  name: z.string().min(1).max(120),
  property_id: z.string().uuid().nullable().optional(),
  scenario_data: z.record(z.string(), z.any()),
  metrics_snapshot: z.record(z.string(), z.any()),
  score_breakdown: z.array(z.object({ label: z.string(), points: z.number() })),
  simulated_score: z.number().int().min(0).max(100),
});

export const createScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ context, data }) => {
    if (data.property_id) {
      const { data: prop } = await context.supabase
        .from("properties").select("id").eq("id", data.property_id).maybeSingle();
      if (!prop) throw new Error("Recurso não encontrado");
    }
    const { data: inserted, error } = await context.supabase
      .from("simulated_scenarios")
      .insert({
        user_id: context.userId,
        name: data.name,
        property_id: data.property_id ?? null,
        scenario_data: data.scenario_data as never,
        metrics_snapshot: data.metrics_snapshot as never,
        score_breakdown: data.score_breakdown as never,
        simulated_score: data.simulated_score,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    // Auditoria: apenas a ação. Nenhum número simulado ou snapshot é gravado.
    await recordAuditEvent(context.supabase, {
      eventType: "scenario_created",
      entityType: "scenario",
      entityId: (inserted as { id?: string })?.id ?? null,
      propertyId: data.property_id ?? null,
      metadata: { source: "simulador" },
    });
    return inserted as unknown as SimulatedScenarioRow;
  });

export const deleteScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("simulated_scenarios")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAuditEvent(context.supabase, {
      eventType: "scenario_deleted",
      entityType: "scenario",
      entityId: data.id,
      metadata: { source: "simulador" },
    });
    return { ok: true };
  });