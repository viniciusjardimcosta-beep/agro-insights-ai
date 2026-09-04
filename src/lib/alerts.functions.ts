import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAuditEvent } from "@/lib/audit.server";

const NOT_FOUND = "Recurso não encontrado";

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("intelligence_alerts")
      .select("*")
      .order("last_seen_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const syncAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireEntitlement } = await import("@/lib/subscription.server");
    const { FEATURES } = await import("@/lib/entitlements");
    await requireEntitlement(context.supabase, FEATURES.ALERTS);

    const { syncAlertsFor } = await import("@/lib/alerts.server");
    return syncAlertsFor(context.supabase, context.userId);
  });

export const acknowledgeAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: existing } = await context.supabase
      .from("intelligence_alerts")
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!existing) throw new Error(NOT_FOUND);
    if (existing.status === "resolved") throw new Error("Alerta já resolvido");
    const { error } = await context.supabase
      .from("intelligence_alerts")
      .update({ status: "acknowledged" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAuditEvent(context.supabase, {
      eventType: "alert_acknowledged",
      entityType: "alert",
      entityId: data.id,
      metadata: { source: "alertas" },
    });
    return { ok: true };
  });
