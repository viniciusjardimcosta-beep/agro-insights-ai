import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeAccess, type SubscriptionAccess } from "@/lib/entitlements";

/**
 * Server functions da assinatura.
 *
 * SEGURANÇA:
 * - Nenhuma delas aceita `user_id`, `plan_code`, `status` ou datas do cliente.
 * - Nenhuma promove plano: a ativação comercial virá do webhook (Sprint 3.4B).
 * - Provider IDs não são retornados ao frontend.
 */

/**
 * Idempotente: cria o trial na primeira entrada no produto e, depois disso,
 * apenas devolve o estado atual. Chamar N vezes nunca gera um segundo trial.
 */
export const ensureMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionAccess> => {
    const { ensureSubscription } = await import("@/lib/subscription.server");
    const { recordAuditEvent } = await import("@/lib/audit.server");
    const { row, created } = await ensureSubscription(context.supabase);
    if (created) {
      await recordAuditEvent(context.supabase, {
        eventType: "trial_started",
        metadata: { source: "app_entry" },
      });
    }
    const access = computeAccess(row, new Date());
    if (!created && row && access.effectiveStatus === "expired" && row.status === "trialing") {
      await recordAuditEvent(context.supabase, {
        eventType: "trial_expired",
        metadata: { source: "app_entry" },
      });
    }
    return access;
  });

/** Somente leitura do próprio acesso — sempre com o relógio do servidor. */
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionAccess> => {
    const { getSubscriptionAccess } = await import("@/lib/subscription.server");
    return getSubscriptionAccess(context.supabase);
  });
