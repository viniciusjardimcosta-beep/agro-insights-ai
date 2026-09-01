import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Ponte cliente → auditoria para eventos que só existem no browser
 * (login/logout e geração do relatório executivo, que roda 100% no cliente).
 *
 * O cliente NÃO informa user_id: a identidade vem de `context.userId`
 * (token verificado) e, no banco, de `auth.uid()`.
 * O conjunto de eventos aceitos é fechado — nada arbitrário é gravado.
 */
const CLIENT_EVENTS = [
  "login_success",
  "logout",
  "executive_report_generated",
  "executive_report_failed",
] as const;

const input = z.object({
  eventType: z.enum(CLIENT_EVENTS),
  status: z.enum(["success", "failure", "started", "blocked"]).optional(),
  correlationId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source: z.string().max(40).optional(),
});

export const logClientAuditEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ context, data }) => {
    const { recordAuditEvent } = await import("@/lib/audit.server");
    await recordAuditEvent(context.supabase, {
      eventType: data.eventType,
      status: data.status ?? "success",
      correlationId: data.correlationId ?? null,
      // sanitizeAuditMetadata aplica a allowlist; `source` é operacional.
      metadata: { ...(data.metadata ?? {}), ...(data.source ? { source: data.source } : {}) },
    });
    return { ok: true };
  });
